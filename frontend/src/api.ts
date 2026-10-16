import type { Job, Track } from './types'

// ---- configuração do servidor de separação (salva no aparelho)
export interface ServerConfig {
  url: string
  token: string
}

const CONFIG_KEY = 'server-config'
const DEFAULT_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000'

export function getServer(): ServerConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null')
    if (saved?.url) return saved
  } catch {
    /* config inválida */
  }
  return { url: DEFAULT_URL, token: '' }
}

export function setServer(cfg: ServerConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...cfg, url: cfg.url.trim().replace(/\/+$/, '') }))
}

async function request<T>(path: string, init?: RequestInit, cfg = getServer()): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body) headers['Content-Type'] = 'application/json'
  if (cfg.token) headers['X-Api-Token'] = cfg.token
  let res: Response
  try {
    res = await fetch(`${cfg.url}/api${path}`, { ...init, headers })
  } catch {
    throw new Error('Não foi possível conectar ao servidor de separação. Verifique o endereço em Ajustes.')
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* resposta sem JSON */
    }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const serverFileUrl = (trackId: string, name: string) => `${getServer().url}/api/files/${trackId}/${name}.mp3`

export interface Health {
  ok: boolean
  model: string
  device: string
  token_required: boolean
}

export const api = {
  health: (cfg?: ServerConfig) => request<Health>('/health', undefined, cfg),
  tracks: () => request<Track[]>('/tracks'),
  track: (id: string) => request<Track>(`/tracks/${id}`),
  jobs: () => request<Job[]>('/jobs'),
  createJob: (url: string) => request<Job>('/jobs', { method: 'POST', body: JSON.stringify({ url }) }),
  dismissJob: (id: string) => request(`/jobs/${id}`, { method: 'DELETE' }),
}

export function formatTime(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '--:--'
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
