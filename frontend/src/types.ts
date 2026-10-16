export interface Track {
  id: string
  title: string
  artist: string
  thumbnail: string | null
  duration: number | null
  source_url: string
  stems: string[]
  model: string
  created_at: number
}

export type JobStatus = 'queued' | 'info' | 'downloading' | 'separating' | 'finishing' | 'done' | 'error'

export interface Job {
  id: string
  url: string
  status: JobStatus
  progress: number
  message: string
  title: string | null
  track_id: string | null
  created_at: number
}

export interface Playlist {
  id: string
  name: string
  track_ids: string[]
  created_at: number
}

export interface StemInfo {
  label: string
  color: string
}

export const STEMS: Record<string, StemInfo> = {
  vocals: { label: 'Voz', color: '#ff5c8a' },
  drums: { label: 'Bateria', color: '#ffb547' },
  bass: { label: 'Baixo', color: '#5ce1a6' },
  piano: { label: 'Piano', color: '#5cb8ff' },
  guitar: { label: 'Guitarra', color: '#c38cff' },
  other: { label: 'Outros', color: '#9aa0b4' },
}

export const stemInfo = (name: string): StemInfo => STEMS[name] ?? { label: name, color: '#9aa0b4' }
