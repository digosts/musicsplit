import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import * as db from './db'
import Library from './components/Library'
import Player from './components/Player'
import Settings from './components/Settings'
import type { Job, Playlist } from './types'

const ACTIVE = new Set(['queued', 'info', 'downloading', 'separating', 'finishing'])
const MY_JOBS = 'my-jobs'

const loadMyJobs = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(MY_JOBS) ?? '[]')
  } catch {
    return []
  }
}

function readHash() {
  if (location.hash === '#/ajustes') return { page: 'settings' as const }
  const m = location.hash.match(/^#\/play\/([^?]+)(?:\?list=(.+))?/)
  return m
    ? { page: 'player' as const, trackId: decodeURIComponent(m[1]), listId: m[2] ? decodeURIComponent(m[2]) : 'all' }
    : { page: 'library' as const }
}

export interface PlaylistActions {
  create: (name: string, trackIds?: string[]) => Promise<Playlist>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setTracks: (id: string, trackIds: string[]) => Promise<void>
}

export default function App() {
  const [tracks, setTracks] = useState<db.LocalTrack[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [importing, setImporting] = useState<Record<string, number>>({})
  const [route, setRoute] = useState(readHash)
  const [listId, setListId] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const importingRef = useRef(new Set<string>())

  const refreshTracks = useCallback(() => db.listTracks().then(setTracks), [])
  const refreshPlaylists = useCallback(() => db.listPlaylists().then(setPlaylists), [])

  useEffect(() => {
    refreshTracks()
    refreshPlaylists()
  }, [refreshTracks, refreshPlaylists])

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /** Baixa a música separada do servidor para o aparelho. */
  const importTrack = useCallback(
    async (trackId: string) => {
      if (importingRef.current.has(trackId)) return
      importingRef.current.add(trackId)
      setImporting((p) => ({ ...p, [trackId]: 0 }))
      try {
        if (!(await db.hasTrack(trackId))) {
          await db.importTrack(trackId, (pct) => setImporting((p) => ({ ...p, [trackId]: pct })))
        }
        await refreshTracks()
      } catch (e) {
        setError(`Erro ao salvar no aparelho: ${(e as Error).message}`)
      } finally {
        importingRef.current.delete(trackId)
        setImporting(({ [trackId]: _, ...rest }) => rest)
      }
    },
    [refreshTracks],
  )

  // acompanha o progresso dos meus pedidos no servidor
  const pollJobs = useCallback(async () => {
    const mine = loadMyJobs()
    if (!mine.length) return setJobs([])
    try {
      const all = await api.jobs()
      const visible = all.filter((j) => mine.includes(j.id))
      // o servidor reiniciou e perdeu o pedido: esquece ele
      localStorage.setItem(MY_JOBS, JSON.stringify(mine.filter((id) => all.some((j) => j.id === id))))
      setJobs(visible)
      for (const j of visible) {
        if (j.status === 'done' && j.track_id && !(await db.hasTrack(j.track_id))) importTrack(j.track_id)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [importTrack])

  useEffect(() => {
    pollJobs()
  }, [pollJobs])

  const hasActive = jobs.some((j) => ACTIVE.has(j.status))
  useEffect(() => {
    if (!hasActive) return
    const id = setInterval(pollJobs, 1500)
    return () => clearInterval(id)
  }, [hasActive, pollJobs])

  const addJob = async (url: string) => {
    setError(null)
    const job = await api.createJob(url)
    localStorage.setItem(MY_JOBS, JSON.stringify([job.id, ...loadMyJobs()]))
    setJobs((prev) => [job, ...prev])
  }

  const dismissJob = async (id: string) => {
    localStorage.setItem(MY_JOBS, JSON.stringify(loadMyJobs().filter((j) => j !== id)))
    setJobs((prev) => prev.filter((j) => j.id !== id))
    api.dismissJob(id).catch(() => {})
  }

  const deleteTrack = async (track: db.LocalTrack) => {
    if (!confirm(`Excluir "${track.title}" do aparelho?`)) return
    await db.deleteTrack(track)
    await Promise.all([refreshTracks(), refreshPlaylists()])
  }

  const playlistActions: PlaylistActions = {
    create: async (name, trackIds = []) => {
      const pl: Playlist = { id: crypto.randomUUID().slice(0, 8), name, track_ids: trackIds, created_at: Date.now() }
      await db.savePlaylist(pl)
      await refreshPlaylists()
      return pl
    },
    rename: async (id, name) => {
      const pl = playlists.find((p) => p.id === id)
      if (pl) await db.savePlaylist({ ...pl, name })
      await refreshPlaylists()
    },
    remove: async (id) => {
      await db.deletePlaylist(id)
      if (listId === id) setListId('all')
      await refreshPlaylists()
    },
    setTracks: async (id, trackIds) => {
      const pl = playlists.find((p) => p.id === id)
      if (!pl) return
      const next = { ...pl, track_ids: [...new Set(trackIds)] }
      setPlaylists((prev) => prev.map((p) => (p.id === id ? next : p)))
      await db.savePlaylist(next)
    },
  }

  const listTracks = useCallback(
    (id: string) => {
      if (id === 'all') return tracks
      const pl = playlists.find((p) => p.id === id)
      if (!pl) return tracks
      return pl.track_ids.map((tid) => tracks.find((t) => t.id === tid)).filter((t): t is db.LocalTrack => !!t)
    },
    [tracks, playlists],
  )

  const current = route.page === 'player' ? tracks.find((t) => t.id === route.trackId) ?? null : null
  const playerList = route.page === 'player' ? route.listId : 'all'
  const queue = useMemo(() => listTracks(playerList), [listTracks, playerList])

  const openTrack = (track: db.LocalTrack, list = listId) => {
    location.hash = `#/play/${encodeURIComponent(track.id)}?list=${encodeURIComponent(list)}`
  }

  if (route.page === 'settings') {
    return <Settings onBack={() => (location.hash = '')} onImport={importTrack} localIds={tracks.map((t) => t.id)} importing={importing} />
  }

  if (current) {
    return (
      <Player
        key={current.id}
        track={current}
        queue={queue}
        onBack={() => (location.hash = '')}
        onSelect={(t) => openTrack(t, playerList)}
      />
    )
  }

  return (
    <Library
      tracks={tracks}
      playlists={playlists}
      jobs={jobs}
      importing={importing}
      listId={listId}
      error={error}
      onDismissError={() => setError(null)}
      onListChange={setListId}
      listTracks={listTracks}
      onAddJob={addJob}
      onDismissJob={dismissJob}
      onOpen={openTrack}
      onDelete={deleteTrack}
      playlistActions={playlistActions}
    />
  )
}
