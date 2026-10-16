import { useEffect, useState } from 'react'
import { api, formatBytes, formatTime, getServer, setServer, type Health } from '../api'
import type { Track } from '../types'

interface Props {
  onBack: () => void
  onImport: (trackId: string) => void
  localIds: string[]
  importing: Record<string, number>
}

export default function Settings({ onBack, onImport, localIds, importing }: Props) {
  const [cfg, setCfg] = useState(getServer)
  const [health, setHealth] = useState<Health | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [serverTracks, setServerTracks] = useState<Track[] | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }))
  }, [localIds.length])

  const test = async () => {
    setStatus('Testando…')
    setHealth(null)
    setServerTracks(null)
    try {
      const h = await api.health(cfg)
      setServer(cfg)
      setHealth(h)
      setStatus('Conectado e salvo!')
      setServerTracks(await api.tracks())
    } catch (e) {
      setStatus((e as Error).message)
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Voltar">
          ←
        </button>
        <div className="now">
          <strong>Ajustes</strong>
        </div>
      </header>

      <section className="card form">
        <h3>Servidor de separação</h3>
        <p className="hint">
          Endereço do backend que baixa e separa as músicas (seu PC via Cloudflare Tunnel, ou um Hugging Face Space). Ex.:
          https://exemplo.trycloudflare.com
        </p>
        <label htmlFor="srv">Endereço</label>
        <input id="srv" type="url" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
        <label htmlFor="tok">Token (opcional)</label>
        <input id="tok" type="password" value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
        <button className="primary" onClick={test}>
          Testar e salvar
        </button>
        {status && <p className={health ? 'ok' : 'error'}>{status}</p>}
        {health && (
          <p className="hint">
            Modelo: {health.model} · Processador: {health.device}
          </p>
        )}
      </section>

      {serverTracks && (
        <section className="card">
          <h3>Músicas no servidor</h3>
          <p className="hint">Traga para este aparelho músicas que já foram separadas (ex.: processadas pelo celular ou PC).</p>
          {serverTracks.length === 0 && <p className="hint">Nenhuma.</p>}
          <ul className="server-list">
            {serverTracks.map((t) => {
              const has = localIds.includes(t.id)
              const imp = importing[t.id]
              return (
                <li key={t.id}>
                  <span>
                    {t.title} <small>· {formatTime(t.duration)}</small>
                  </span>
                  <button className="ghost small" disabled={has || imp !== undefined} onClick={() => onImport(t.id)}>
                    {has ? 'No aparelho' : imp !== undefined ? `${Math.round(imp)}%` : 'Baixar'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {usage && (
        <section className="card">
          <h3>Armazenamento</h3>
          <p className="hint">
            {formatBytes(usage.used)} usados de {formatBytes(usage.quota)} disponíveis para o app neste aparelho.
          </p>
        </section>
      )}
    </div>
  )
}
