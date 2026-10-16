import { openDB, type DBSchema } from 'idb'
import type { Playlist, Track } from './types'

/** Tudo fica no aparelho: músicas, áudio das faixas e playlists. */
interface StemsDB extends DBSchema {
  tracks: { key: string; value: Track }
  files: { key: string; value: Blob }
  playlists: { key: string; value: Playlist }
}

const dbPromise = openDB<StemsDB>('stems-studio', 1, {
  upgrade(db) {
    db.createObjectStore('tracks', { keyPath: 'id' })
    db.createObjectStore('files')
    db.createObjectStore('playlists', { keyPath: 'id' })
  },
})

const fileKey = (trackId: string, name: string) => `${trackId}/${name}`
export const trackFiles = (t: Track) => [...t.stems, 'original']

export async function listTracks(): Promise<Track[]> {
  const all = await (await dbPromise).getAll('tracks')
  return all.sort((a, b) => b.created_at - a.created_at)
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

export async function saveTrack(track: Track, files: Record<string, Blob>) {
  const db = await dbPromise
  const tx = db.transaction(['tracks', 'files'], 'readwrite')
  for (const [name, blob] of Object.entries(files)) tx.objectStore('files').put(blob, fileKey(track.id, name))
  tx.objectStore('tracks').put(track)
  await tx.done
  navigator.storage?.persist?.()
}

export async function updateTrack(track: Track) {
  await (await dbPromise).put('tracks', track)
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
