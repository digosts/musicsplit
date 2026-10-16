import { useMemo, useState, type FormEvent } from 'react'
import { formatBytes, formatTime } from '../api'
import type { PlaylistActions } from '../App'
import type { LocalTrack } from '../db'
import { stemInfo, type Job, type Playlist } from '../types'

interface Props {
  tracks: LocalTrack[]
  playlists: Playlist[]
  jobs: Job[]
  importing: Record<string, number>
  listId: string
  error: string | null
  onDismissError: () => void
  onListChange: (id: string) => void
  listTracks: (id: string) => LocalTrack[]
  onAddJob: (url: string) => Promise<void>
  onDismissJob: (id: string) => void
  onOpen: (t: LocalTrack) => void
  onDelete: (t: LocalTrack) => void
  playlistActions: PlaylistActions
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Na fila',
  info: 'Lendo vídeo',
  downloading: 'Baixando',
  separating: 'Separando faixas',
  finishing: 'Finalizando',
  done: 'Pronto',
  error: 'Erro',
}

export default function Library(props: Props) {
  const { tracks, playlists, jobs, importing, listId, playlistActions: pa } = props
  const [url, setUrl] = useState('')
  const [sending, setSending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const playlist = playlists.find((p) => p.id === listId)
  const list = props.listTracks(listId)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? list.filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(q)) : list
  }, [list, search])
  const totalSize = tracks.reduce((n, t) => n + t.size, 0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setSending(true)
    setFormError(null)
    try {
      await props.onAddJob(url.trim())
      setUrl('')
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const paste = async () => {
    try {
      setUrl(await navigator.clipboard.readText())
    } catch {
      /* sem permissão de leitura da área de transferência */
    }
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

      <form className="card add" onSubmit={submit}>
        <label htmlFor="url">Separar uma música</label>
        <div className="add-row">
          <input
            id="url"
            type="url"
            inputMode="url"
            placeholder="Cole o link do YouTube…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {!url && 'clipboard' in navigator && (
            <button type="button" className="ghost" onClick={paste}>
              Colar
            </button>
          )}
          <button type="submit" className="primary" disabled={sending || !url.trim()}>
            {sending ? 'Enviando…' : 'Separar'}
          </button>
        </div>
        <p className="hint">Voz · Bateria · Baixo · Piano · Guitarra · Outros — separação por IA (Demucs)</p>
        {formError && <p className="error">{formError}</p>}
      </form>

      {props.error && (
        <div className="card error-card">
          <span>{props.error}</span>
          <button className="ghost" onClick={props.onDismissError}>
            ✕
          </button>
        </div>
      )}

      {jobs.length > 0 && (
        <section className="jobs">
          {jobs.map((job) => {
            const imp = job.track_id != null ? importing[job.track_id] : undefined
            const saving = imp !== undefined
            const pct = saving ? imp : job.progress
            return (
              <div key={job.id} className={`card job ${job.status}`}>
                <div className="job-head">
                  <strong>{job.title ?? job.url}</strong>
                  {(job.status === 'done' || job.status === 'error') && !saving && (
                    <button className="ghost small" onClick={() => props.onDismissJob(job.id)} aria-label="Remover">
                      ✕
                    </button>
                  )}
                </div>
                <div className="job-status">
                  {saving ? 'Salvando no aparelho' : STATUS_LABEL[job.status]}
                  {job.status !== 'error' && job.status !== 'queued' && ` · ${Math.round(pct)}%`}
                </div>
                {job.status === 'error' ? (
                  <pre className="error">{job.message}</pre>
                ) : (
                  <div className="progress">
                    <div style={{ width: `${job.status === 'done' && !saving ? 100 : pct}%` }} />
                  </div>
                )}
              </div>
            )
          })}
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

      {filtered.length === 0 ? (
        <div className="empty">
          {tracks.length === 0
            ? 'Nenhuma música ainda. Cole um link do YouTube acima para começar.'
            : playlist
              ? 'Playlist vazia. Use o menu ⋮ de uma música em "Todas" para adicioná-la aqui.'
              : 'Nada encontrado.'}
        </div>
      ) : (
        <ul className="tracks">
          {filtered.map((t, i) => (
            <li key={t.id} className="track">
              <button className="track-main" onClick={() => props.onOpen(t)}>
                {t.thumbnail ? <img src={t.thumbnail} alt="" loading="lazy" /> : <div className="thumb-ph">♪</div>}
                <div className="track-text">
                  <strong>{t.title}</strong>
                  <span>
                    {t.artist} · {formatTime(t.duration)}
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
                    <a className="menu-item" href={t.source_url} target="_blank" rel="noreferrer">
                      Abrir no YouTube
                    </a>
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
