export interface Track {
  id: string
  title: string
  artist: string
  duration: number
  stems: string[]
  file_name: string
  size: number
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

/** Ordem de exibição no mixer. */
export const STEM_ORDER = ['vocals', 'drums', 'bass', 'piano', 'guitar', 'other']

export const STEMS: Record<string, StemInfo> = {
  vocals: { label: 'Voz', color: '#ff5c8a' },
  drums: { label: 'Bateria', color: '#ffb547' },
  bass: { label: 'Baixo', color: '#5ce1a6' },
  piano: { label: 'Piano', color: '#5cb8ff' },
  guitar: { label: 'Guitarra', color: '#c38cff' },
  other: { label: 'Outros', color: '#9aa0b4' },
}

export const stemInfo = (name: string): StemInfo => STEMS[name] ?? { label: name, color: '#9aa0b4' }
