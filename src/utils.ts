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

/** Cor estável a partir de um texto (usada na capa das músicas). */
export function hue(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** "Artista - Título.mp3" → { artist, title } */
export function parseFileName(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim()
  const m = base.match(/^(.+?)\s+[-–]\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base }
}

// ---- preferências (salvas no aparelho)
export interface Prefs {
  bitrate: 320 | 256 | 192
}

const PREFS_KEY = 'prefs'

export function getPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return { bitrate: [320, 256, 192].includes(saved.bitrate) ? saved.bitrate : 320 }
  } catch {
    return { bitrate: 320 }
  }
}

export function setPrefs(p: Prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p))
}
