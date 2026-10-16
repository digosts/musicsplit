import { useCallback, useEffect, useRef, useState } from 'react'
import * as db from '../db'
import { STEM_ORDER, type Track } from '../types'
import { getPrefs, parseFileName } from '../utils'
import type { WorkerIn, WorkerOut } from './protocol'

export type JobStatus = 'queued' | 'decoding' | 'model' | 'loading' | 'separating' | 'saving' | 'done' | 'error'

export interface Job {
  id: string
  file: File
  title: string
  status: JobStatus
  progress: number
  detail?: string
  eta?: number
  backend?: string
  error?: string
  trackId?: string
}

const MAX_SECONDS = 15 * 60

/** Decodifica qualquer áudio que o navegador entenda, já reamostrado para 44,1 kHz estéreo. */
async function decode(file: File) {
  const ctx = new OfflineAudioContext(2, 1, 44100)
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new Error('Não foi possível ler este arquivo. Use MP3, M4A, WAV, FLAC ou OGG.')
  }
  if (buffer.duration > MAX_SECONDS) throw new Error('A música é longa demais (máximo de 15 minutos).')
  const left = buffer.getChannelData(0).slice()
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice()
  return { left, right, duration: buffer.duration }
}

/** Fila de músicas para separar, uma de cada vez (o modelo usa bastante memória). */
export function useSeparationQueue(onSaved: (t: Track) => void) {
  const [jobs, setJobs] = useState<Job[]>([])
  const workerRef = useRef<Worker | null>(null)
  const runningRef = useRef<string | null>(null)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved

  const patch = useCallback((id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j))), [])

  const run = useCallback(
    async (job: Job) => {
      runningRef.current = job.id
      let wakeLock: WakeLockSentinel | undefined
      try {
        wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined)
        patch(job.id, { status: 'decoding', progress: 0 })
        const { left, right, duration } = await decode(job.file)
        const prefs = getPrefs()

        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = worker
        const result = await new Promise<{ files: Record<string, Blob>; stems: string[] }>((resolve, reject) => {
          worker.onmessage = (e: MessageEvent<WorkerOut>) => {
            const msg = e.data
            if (msg.type === 'progress') patch(job.id, { status: msg.phase, progress: msg.progress, detail: msg.detail, eta: msg.eta })
            else if (msg.type === 'backend') patch(job.id, { backend: `${msg.threads} ${msg.threads > 1 ? 'núcleos' : 'núcleo'}` })
            else if (msg.type === 'done') resolve(msg)
            else reject(new Error(msg.message))
          }
          worker.onerror = (e) => reject(new Error(e.message || 'Falha no processamento'))
          ;(worker as Worker & { cancel?: () => void }).cancel = () => reject(new Error('Cancelado'))
          const input: WorkerIn = { left, right, bitrate: prefs.bitrate }
          worker.postMessage(input, [left.buffer, right.buffer])
        })

        patch(job.id, { status: 'saving', progress: 1 })
        const { title, artist } = parseFileName(job.file.name)
        const track: Track = {
          id: crypto.randomUUID(),
          title,
          artist,
          duration,
          stems: [...result.stems].sort((a, b) => STEM_ORDER.indexOf(a) - STEM_ORDER.indexOf(b)),
          file_name: job.file.name,
          size: Object.values(result.files).reduce((n, b) => n + b.size, 0),
          created_at: Date.now(),
        }
        await db.saveTrack(track, result.files)
        patch(job.id, { status: 'done', progress: 1, trackId: track.id })
        onSavedRef.current(track)
      } catch (err) {
        patch(job.id, { status: 'error', error: (err as Error).message })
      } finally {
        workerRef.current?.terminate()
        workerRef.current = null
        runningRef.current = null
        wakeLock?.release().catch(() => {})
      }
    },
    [patch],
  )

  // inicia o próximo da fila quando nenhum estiver rodando
  useEffect(() => {
    if (runningRef.current) return
    const next = jobs.find((j) => j.status === 'queued')
    if (next) run(next)
  }, [jobs, run])

  // avisa antes de fechar a página no meio de um processamento
  const busy = jobs.some((j) => !['done', 'error', 'queued'].includes(j.status))
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const add = (files: File[]) =>
    setJobs((js) => [
      ...js,
      ...files.map((file) => ({ id: crypto.randomUUID(), file, title: parseFileName(file.name).title, status: 'queued' as const, progress: 0 })),
    ])

  const cancel = (id: string) => {
    if (runningRef.current === id) {
      const w = workerRef.current as (Worker & { cancel?: () => void }) | null
      w?.terminate()
      w?.cancel?.()
    }
    setJobs((js) => js.filter((j) => j.id !== id))
  }

  const dismiss = (id: string) => setJobs((js) => js.filter((j) => j.id !== id))

  return { jobs, add, cancel, dismiss }
}
