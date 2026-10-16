import { openDB, type DBSchema } from 'idb'
import { api, serverFileUrl } from './api'
import type { Playlist, Track } from './types'

/** Tudo fica no aparelho: músicas, áudio das faixas e playlists. */
interface StemsDB extends DBSchema {
  tracks: { key: string; value: Track & { size: number; added_at: number } }
  files: { key: string; value: Blob }
  playlists: { key: string; value: Playlist }
}

export type LocalTrack = StemsDB['tracks']['value']

const dbPromise = openDB<StemsDB>('stems-studio', 1, {
  upgrade(db) {
    db.createObjectStore('tracks', { keyPath: 'id' })
    db.createObjectStore('files')
    db.createObjectStore('playlists', { keyPath: 'id' })
  },
})

const fileKey = (trackId: string, name: string) => `${trackId}/${name}`
export const trackFiles = (t: Track) => [...t.stems, 'original']

export async function listTracks(): Promise<LocalTrack[]> {
  const all = await (await dbPromise).getAll('tracks')
  return all.sort((a, b) => b.added_at - a.added_at)
}

export async function hasTrack(id: string) {
  return !!(await (await dbPromise).getKey('tracks', id))
}

export async function getFileUrls(t: Track): Promise<Record<string, string>> {
  const db = await dbPromise
  const entries = await Promise.all(
    trackFiles(t).map(async (name) => {
      const blob = await db.get('files', fileKey(t.id, name))
      return [name, blob ? URL.createObjectURL(blob) : ''] as const
    }),
  )
  return Object.fromEntries(entries.filter(([, url]) => url))
}

export async function getFile(trackId: string, name: string) {
  return (await dbPromise).get('files', fileKey(trackId, name))
}

/** Baixa do servidor a música já separada e guarda no aparelho. */
export async function importTrack(trackId: string, onProgress?: (pct: number) => void): Promise<LocalTrack> {
  const meta = await api.track(trackId)
  const names = trackFiles(meta)
  const blobs: Blob[] = []
  for (const [i, name] of names.entries()) {
    const res = await fetch(serverFileUrl(trackId, name))
    if (!res.ok) throw new Error(`Falha ao baixar a faixa ${name}`)
    blobs.push(await res.blob())
    onProgress?.(((i + 1) / names.length) * 100)
  }
  const local: LocalTrack = { ...meta, size: blobs.reduce((n, b) => n + b.size, 0), added_at: Date.now() }
  const db = await dbPromise
  const tx = db.transaction(['tracks', 'files'], 'readwrite')
  names.forEach((name, i) => tx.objectStore('files').put(blobs[i], fileKey(trackId, name)))
  tx.objectStore('tracks').put(local)
  await tx.done
  navigator.storage?.persist?.()
  return local
}

export async function deleteTrack(t: Track) {
  const db = await dbPromise
  const tx = db.transaction(['tracks', 'files', 'playlists'], 'readwrite')
  trackFiles(t).forEach((name) => tx.objectStore('files').delete(fileKey(t.id, name)))
  tx.objectStore('tracks').delete(t.id)
  for (const pl of await tx.objectStore('playlists').getAll()) {
    if (pl.track_ids.includes(t.id)) {
      tx.objectStore('playlists').put({ ...pl, track_ids: pl.track_ids.filter((id) => id !== t.id) })
    }
  }
  await tx.done
}

export async function listPlaylists(): Promise<Playlist[]> {
  const all = await (await dbPromise).getAll('playlists')
  return all.sort((a, b) => a.created_at - b.created_at)
}

export async function savePlaylist(pl: Playlist) {
  await (await dbPromise).put('playlists', pl)
}

export async function deletePlaylist(id: string) {
  await (await dbPromise).delete('playlists', id)
}
