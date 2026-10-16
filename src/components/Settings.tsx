import { useEffect, useState } from 'react'
import { deleteModel, isModelCached } from '../separator/protocol'
import { formatBytes, getPrefs, setPrefs, type Prefs } from '../utils'

export default function Settings({ onBack }: { onBack: () => void }) {
  const [prefs, setState] = useState(getPrefs)
  const [modelCached, setModelCached] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)

  const refresh = () => {
    isModelCached().then(setModelCached)
    navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }))
  }
  useEffect(refresh, [])

  const update = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p }
    setState(next)
    setPrefs(next)
  }

  const threads = self.crossOriginIsolated ? Math.min(8, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)) : 1

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
        <h3>Processamento</h3>
        <p className="hint">
          A IA roda na CPU deste aparelho usando {threads} {threads > 1 ? 'núcleos' : 'núcleo'}. Em computadores, uma música de 4 minutos
          leva por volta de 3 a 5 minutos; no celular pode levar bem mais.
          {!self.crossOriginIsolated && ' (multinúcleo desativado: o site precisa ser servido com os headers COOP/COEP)'}
        </p>

        <label htmlFor="br">Qualidade do MP3 das faixas</label>
        <select id="br" value={prefs.bitrate} onChange={(e) => update({ bitrate: Number(e.target.value) as Prefs['bitrate'] })}>
          <option value={320}>320 kbps (máxima)</option>
          <option value={256}>256 kbps</option>
          <option value={192}>192 kbps (ocupa menos espaço)</option>
        </select>
      </section>

      <section className="card form">
        <h3>Modelo de IA</h3>
        <p className="hint">
          Demucs htdemucs_6s (Meta, licença MIT), ~136 MB. É baixado uma única vez e fica guardado no aparelho.
        </p>
        <p>{modelCached == null ? '…' : modelCached ? '✓ Baixado neste aparelho' : 'Ainda não baixado (será baixado na primeira separação)'}</p>
        {modelCached && (
          <button
            className="ghost danger"
            onClick={async () => {
              if (!confirm('Apagar o modelo? Ele será baixado de novo na próxima separação.')) return
              await deleteModel()
              refresh()
            }}
          >
            Apagar modelo
          </button>
        )}
      </section>

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
