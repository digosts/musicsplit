import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { getFile, getFileUrls } from '../db'
import { useMixer } from '../mixer'
import { stemInfo, type Track } from '../types'
import { formatTime } from '../utils'
import Cover from './Cover'

interface Props {
  track: Track
  queue: Track[]
  onBack: () => void
  onSelect: (t: Track) => void
}

const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25]

export default function Player({ track, queue, onBack, onSelect }: Props) {
  const [urls, setUrls] = useState<Record<string, string> | null>(null)
  const [autoNext, setAutoNext] = useState(() => localStorage.getItem('auto-next') !== '0')
  const index = queue.findIndex((t) => t.id === track.id)
  const prev = index > 0 ? queue[index - 1] : null
  const next = index >= 0 && index < queue.length - 1 ? queue[index + 1] : null
  const nextRef = useRef(next)
  nextRef.current = autoNext ? next : null

  useEffect(() => {
    let created: Record<string, string> = {}
    getFileUrls(track).then((u) => {
      created = u
      setUrls(u)
    })
    return () => Object.values(created).forEach(URL.revokeObjectURL)
  }, [track])

  const m = useMixer(track, urls, () => nextRef.current && onSelect(nextRef.current))
  const mRef = useRef(m)
  mRef.current = m

  // atalhos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      const mx = mRef.current
      if (e.code === 'Space') {
        e.preventDefault()
        mx.toggle()
      } else if (e.code === 'ArrowLeft') mx.seek(mx.time - 5)
      else if (e.code === 'ArrowRight') mx.seek(mx.time + 5)
      else if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  // controles na tela de bloqueio / fones (Media Session)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      artwork: [{ src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }],
    })
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => mRef.current.play())
    ms.setActionHandler('pause', () => mRef.current.pause())
    ms.setActionHandler('seekbackward', () => mRef.current.seek(mRef.current.time - 5))
    ms.setActionHandler('seekforward', () => mRef.current.seek(mRef.current.time + 5))
    ms.setActionHandler('seekto', (d) => d.seekTime != null && mRef.current.seek(d.seekTime))
    ms.setActionHandler('previoustrack', prev ? () => onSelect(prev) : null)
    ms.setActionHandler('nexttrack', next ? () => onSelect(next) : null)
  }, [track, prev, next, onSelect])

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = m.playing ? 'playing' : 'paused'
  }, [m.playing])

  const download = async (name: string) => {
    const blob = await getFile(track.id, name)
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${track.title} - ${name === 'original' ? 'original' : stemInfo(name).label}.mp3`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const { loop } = m
  const setA = () => m.setLoop({ enabled: loop.b != null && loop.b > m.time, a: m.time, b: loop.b != null && loop.b > m.time ? loop.b : null })
  const setB = () => loop.a != null && m.time > loop.a && m.setLoop({ enabled: true, a: loop.a, b: m.time })
  const anySolo = Object.values(m.stems).some((s) => s.solo)

  return (
    <div className="page player">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          ←
        </button>
        <div className="now">
          <strong>{track.title}</strong>
          <span>{track.artist}</span>
        </div>
        <Cover title={track.title} className="cover cover-art" />
      </header>

      {!m.ready && (
        <div className="loading">
          Carregando faixas… {m.loaded}/{m.total || track.stems.length + 1}
        </div>
      )}

      <section className="mixer">
        {track.stems.map((name) => {
          const s = m.stems[name]
          if (!s) return null
          const info = stemInfo(name)
          const audible = !m.original && !s.muted && (!anySolo || s.solo)
          return (
            <div key={name} className={`stem ${audible ? '' : 'off'}`} style={{ '--c': info.color } as React.CSSProperties}>
              <div className="stem-head">
                <span className="stem-name" onDoubleClick={() => m.soloOnly(name)} title="Duplo clique: ouvir só esta faixa">
                  {info.label}
                </span>
                <span className="stem-vol">{Math.round(s.volume * 100)}%</span>
                <button
                  className={`chip ${s.muted ? 'on mute' : ''}`}
                  onClick={() => m.updateStem(name, { muted: !s.muted })}
                  title="Silenciar (mute)"
                >
                  M
                </button>
                <button className={`chip ${s.solo ? 'on solo' : ''}`} onClick={() => m.updateStem(name, { solo: !s.solo })} title="Solo">
                  S
                </button>
                <button className="chip" onClick={() => download(name)} title="Baixar esta faixa" aria-label={`Baixar ${info.label}`}>
                  ↓
                </button>
              </div>
              <input
                type="range"
                className="vol"
                min={0}
                max={1.5}
                step={0.01}
                value={s.volume}
                onChange={(e) => m.updateStem(name, { volume: +e.target.value })}
                onDoubleClick={() => m.updateStem(name, { volume: 1 })}
                aria-label={`Volume ${info.label}`}
              />
              <div className="pan-row">
                <span>E</span>
                <input
                  type="range"
                  className="pan"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={s.pan}
                  onChange={(e) => m.updateStem(name, { pan: +e.target.value })}
                  onDoubleClick={() => m.updateStem(name, { pan: 0 })}
                  aria-label={`Pan ${info.label}`}
                />
                <span>D</span>
              </div>
            </div>
          )
        })}
      </section>

      <div className="mix-actions">
        <button className={`ghost ${m.original ? 'active' : ''}`} onClick={() => m.setOriginal(!m.original)}>
          {m.original ? '● Ouvindo original' : 'Comparar com original'}
        </button>
        <button className="ghost" onClick={m.resetMix}>
          Resetar mix
        </button>
        <button className="ghost" onClick={() => download('original')}>
          ↓ Original
        </button>
      </div>

      <section className="tools card">
        <div className="tool">
          <label>Velocidade · {Math.round(m.rate * 100)}%</label>
          <input type="range" min={0.5} max={1.5} step={0.05} value={m.rate} onChange={(e) => m.setRate(+e.target.value)} />
          <div className="presets">
            {SPEEDS.map((s) => (
              <button key={s} className={`chip ${m.rate === s ? 'on' : ''}`} onClick={() => m.setRate(s)}>
                {s}x
              </button>
            ))}
          </div>
        </div>
        <div className="tool">
          <label>
            Loop A-B {loop.a != null && `· ${formatTime(loop.a)}`} {loop.b != null && `→ ${formatTime(loop.b)}`}
          </label>
          <div className="presets">
            <button className="chip" onClick={setA}>
              A
            </button>
            <button className="chip" onClick={setB} disabled={loop.a == null}>
              B
            </button>
            <button
              className={`chip ${loop.enabled ? 'on' : ''}`}
              disabled={loop.a == null || loop.b == null}
              onClick={() => m.setLoop({ ...loop, enabled: !loop.enabled })}
            >
              Loop {loop.enabled ? 'ligado' : 'desligado'}
            </button>
            <button className="chip" onClick={() => m.setLoop({ enabled: false, a: null, b: null })}>
              Limpar
            </button>
          </div>
        </div>
        <div className="tool">
          <label>Volume geral · {Math.round(m.master * 100)}%</label>
          <input type="range" min={0} max={1.5} step={0.01} value={m.master} onChange={(e) => m.setMaster(+e.target.value)} />
        </div>
      </section>

      <footer className="transport">
        <Seek time={m.time} duration={m.duration} loop={loop} onSeek={m.seek} />
        <div className="buttons">
          <button className="icon-btn" disabled={!prev} onClick={() => prev && onSelect(prev)} aria-label="Anterior">
            ⏮
          </button>
          <button className="icon-btn" onClick={() => m.seek(m.time - 5)} aria-label="Voltar 5 segundos">
            −5
          </button>
          <button className="play" onClick={m.toggle} disabled={!m.ready} aria-label={m.playing ? 'Pausar' : 'Tocar'}>
            {m.buffering ? '…' : m.playing ? '❚❚' : '▶'}
          </button>
          <button className="icon-btn" onClick={() => m.seek(m.time + 5)} aria-label="Avançar 5 segundos">
            +5
          </button>
          <button className="icon-btn" disabled={!next} onClick={() => next && onSelect(next)} aria-label="Próxima">
            ⏭
          </button>
        </div>
        <label className="autonext">
          <input
            type="checkbox"
            checked={autoNext}
            onChange={(e) => {
              setAutoNext(e.target.checked)
              localStorage.setItem('auto-next', e.target.checked ? '1' : '0')
            }}
          />
          Tocar a próxima da lista automaticamente
        </label>
      </footer>
    </div>
  )
}

function Seek({
  time,
  duration,
  loop,
  onSeek,
}: {
  time: number
  duration: number
  loop: { enabled: boolean; a: number | null; b: number | null }
  onSeek: (t: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const pct = (t: number) => (duration ? (t / duration) * 100 : 0)
  const at = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration
  }
  const shown = drag ?? time

  return (
    <div className="seek-wrap">
      <span>{formatTime(shown)}</span>
      <div
        ref={ref}
        className="seek"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(at(e))
        }}
        onPointerMove={(e) => drag != null && setDrag(at(e))}
        onPointerUp={(e) => {
          onSeek(at(e))
          setDrag(null)
        }}
        role="slider"
        aria-label="Posição"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={shown}
      >
        {loop.a != null && (
          <div
            className={`loop-region ${loop.enabled ? 'on' : ''}`}
            style={{ left: `${pct(loop.a)}%`, width: `${Math.max(0.4, pct((loop.b ?? loop.a) - loop.a))}%` }}
          />
        )}
        <div className="seek-fill" style={{ width: `${pct(shown)}%` }} />
        <div className="seek-knob" style={{ left: `${pct(shown)}%` }} />
      </div>
      <span>{formatTime(duration)}</span>
    </div>
  )
}
