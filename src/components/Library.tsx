import { useMemo, useRef, useState, type DragEvent } from 'react'
import type { PlaylistActions } from '../App'
import type { Job } from '../separator/queue'
import { stemInfo, type Playlist, type Track } from '../types'
import { formatBytes, formatTime } from '../utils'
import Cover from './Cover'

interface Props {
  loaded: boolean
  tracks: Track[]
  playlists: Playlist[]
  jobs: Job[]
  listId: string
  onListChange: (id: string) => void
  listTracks: (id: string) => Track[]
  onAddFiles: (files: File[]) => void
  onCancelJob: (id: string) => void
  onDismissJob: (id: string) => void
  onOpen: (t: Track) => void
  onRename: (t: Track) => void
  onDelete: (t: Track) => void
  playlistActions: PlaylistActions
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  decoding: 'Lendo o arquivo',
  model: 'Baixando o modelo de IA (só na primeira vez)',
  loading: 'Preparando a IA',
  separating: 'Separando faixas',
  saving: 'Salvando',
  done: 'Pronto!',
  error: 'Erro',
}

const isAudio = (f: File) => f.type.startsWith('audio/') || f.type.startsWith('video/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm|mp4)$/i.test(f.name)

function formatEta(sec?: number) {
  if (sec == null || !isFinite(sec)) return ''
  return sec < 60 ? ` · falta < 1 min` : ` · faltam ~${Math.round(sec / 60)} min`
}

export default function Library(props: Props) {
  const { tracks, playlists, jobs, listId, playlistActions: pa } = props
  const [search, setSearch] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const playlist = playlists.find((p) => p.id === listId)
  const list = props.listTracks(listId)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? list.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q)) : list
  }, [list, search])
  const totalSize = tracks.reduce((n, t) => n + t.size, 0)

  const addFiles = (files: FileList | null) => {
    const ok = Array.from(files ?? []).filter(isAudio)
    if (ok.length) props.onAddFiles(ok)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const newPlaylist = async () => {
    const name = prompt('Nome da nova playlist:')?.trim()
    if (!name) return
    const pl = await pa.create(name)
    props.onListChange(pl.id)
  }

  const togglePlaylist = (pl: Playlist, trackId: string) =>
    pa.setTracks(pl.id, pl.track_ids.includes(trackId) ? pl.track_ids.filter((id) => id !== trackId) : [...pl.track_ids, trackId])

  const move = (index: number, delta: number) => {
    if (!playlist) return
    const ids = [...playlist.track_ids]
    const [id] = ids.splice(index, 1)
    ids.splice(Math.max(0, Math.min(ids.length, index + delta)), 0, id)
    pa.setTracks(playlist.id, ids)
  }

  return (
    <div className="page" onClick={() => setMenuFor(null)}>
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>Stems Studio</span>
        </div>
        <a className="icon-btn" href="#/ajustes" title="Ajustes" aria-label="Ajustes">
          ⚙
        </a>
      </header>

      <div
        className={`card drop ${dragging ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/mp4,video/webm,.mp3,.m4a,.wav,.flac,.ogg,.opus"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <strong>Separar uma música</strong>
        <p className="hint">Escolha ou arraste arquivos de áudio (MP3, M4A, WAV, FLAC, OGG).</p>
        <button className="primary" onClick={() => inputRef.current?.click()}>
          Escolher arquivo
        </button>
        <p className="hint">
          A IA (Demucs) separa voz, bateria, baixo, piano, guitarra e outros aqui mesmo no seu aparelho, sem enviar nada para a internet.
        </p>
      </div>

      {jobs.length > 0 && (
        <section className="jobs">
          {jobs.map((job) => {
            const active = !['done', 'error', 'queued'].includes(job.status)
            const finished = job.status === 'done' || job.status === 'error'
            return (
              <div key={job.id} className={`card job ${job.status}`}>
                <div className="job-head">
                  <strong>{job.title}</strong>
                  {finished ? (
                    <button className="ghost small" onClick={() => props.onDismissJob(job.id)} aria-label="Remover">
                      ✕
                    </button>
                  ) : (
                    <button className="ghost small" onClick={() => props.onCancelJob(job.id)}>
                      Cancelar
                    </button>
                  )}
                </div>
                <div className="job-status">
                  {STATUS_LABEL[job.status]}
                  {active && job.status !== 'decoding' && job.status !== 'loading' && ` · ${Math.round(job.progress * 100)}%`}
                  {job.status === 'model' && job.detail && ` · ${job.detail}`}
                  {job.status === 'separating' && formatEta(job.eta)}
                  {job.backend && active && ` · ${job.backend}`}
                </div>
                {job.status === 'error' ? (
                  <p className="error">{job.error}</p>
                ) : job.status === 'done' ? (
                  <button
                    className="ghost small"
                    onClick={() => {
                      const t = tracks.find((tr) => tr.id === job.trackId)
                      if (t) props.onOpen(t)
                    }}
                  >
                    Abrir no mixer →
                  </button>
                ) : (
                  <div className={`progress ${job.status === 'decoding' || job.status === 'loading' ? 'indeterminate' : ''}`}>
                    <div style={{ width: `${job.progress * 100}%` }} />
                  </div>
                )}
              </div>
            )
          })}
          {jobs.some((j) => !['done', 'error'].includes(j.status)) && (
            <p className="hint">Mantenha esta aba aberta enquanto as músicas são separadas.</p>
          )}
        </section>
      )}

      <nav className="tabs">
        <button className={listId === 'all' ? 'active' : ''} onClick={() => props.onListChange('all')}>
          Todas ({tracks.length})
        </button>
        {playlists.map((p) => (
          <button key={p.id} className={listId === p.id ? 'active' : ''} onClick={() => props.onListChange(p.id)}>
            {p.name} ({p.track_ids.length})
          </button>
        ))}
        <button className="new-pl" onClick={newPlaylist}>
          + Playlist
        </button>
      </nav>

      <div className="list-tools">
        <input type="search" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {playlist && (
          <>
            <button
              className="ghost"
              onClick={() => {
                const name = prompt('Novo nome:', playlist.name)?.trim()
                if (name) pa.rename(playlist.id, name)
              }}
            >
              Renomear
            </button>
            <button className="ghost danger" onClick={() => confirm(`Excluir a playlist "${playlist.name}"?`) && pa.remove(playlist.id)}>
              Excluir
            </button>
          </>
        )}
      </div>

      {!props.loaded ? null : filtered.length === 0 ? (
        <div className="empty">
          {tracks.length === 0
            ? 'Nenhuma música ainda. Escolha um arquivo acima para começar.'
            : playlist
              ? 'Playlist vazia. Use o menu ⋮ de uma música em "Todas" para adicioná-la aqui.'
              : 'Nada encontrado.'}
        </div>
      ) : (
        <ul className="tracks">
          {filtered.map((t, i) => (
            <li key={t.id} className="track">
              <button className="track-main" onClick={() => props.onOpen(t)}>
                <Cover title={t.title} />
                <div className="track-text">
                  <strong>{t.title}</strong>
                  <span>
                    {t.artist ? `${t.artist} · ` : ''}
                    {formatTime(t.duration)}
                  </span>
                  <span className="dots">
                    {t.stems.map((s) => (
                      <i key={s} style={{ background: stemInfo(s).color }} title={stemInfo(s).label} />
                    ))}
                  </span>
                </div>
              </button>
              {playlist && !search && (
                <div className="reorder">
                  <button className="ghost small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                    ▲
                  </button>
                  <button className="ghost small" disabled={i === filtered.length - 1} onClick={() => move(i, 1)} aria-label="Descer">
                    ▼
                  </button>
                </div>
              )}
              <div className="menu-wrap" onClick={(e) => e.stopPropagation()}>
                <button className="ghost" onClick={() => setMenuFor(menuFor === t.id ? null : t.id)} aria-label="Mais opções">
                  ⋮
                </button>
                {menuFor === t.id && (
                  <div className="menu">
                    <div className="menu-title">Playlists</div>
                    {playlists.length === 0 && <div className="menu-note">Crie uma playlist em “+ Playlist”.</div>}
                    {playlists.map((p) => (
                      <label key={p.id} className="menu-item">
                        <input type="checkbox" checked={p.track_ids.includes(t.id)} onChange={() => togglePlaylist(p, t.id)} />
                        {p.name}
                      </label>
                    ))}
                    <hr />
                    <button className="menu-item" onClick={() => props.onRename(t)}>
                      Editar título/artista
                    </button>
                    <button className="menu-item danger" onClick={() => props.onDelete(t)}>
                      Excluir do aparelho
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {tracks.length > 0 && <p className="footer-note">{formatBytes(totalSize)} salvos neste aparelho · funciona offline</p>}
    </div>
  )
}
