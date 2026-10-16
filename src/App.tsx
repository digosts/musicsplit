import { useCallback, useEffect, useMemo, useState } from 'react'
import * as db from './db'
import Library from './components/Library'
import Player from './components/Player'
import Settings from './components/Settings'
import { useSeparationQueue } from './separator/queue'
import type { Playlist, Track } from './types'

function readHash() {
  if (location.hash === '#/ajustes') return { page: 'settings' as const }
  const m = location.hash.match(/^#\/play\/([^?]+)(?:\?list=(.+))?/)
  return m
    ? { page: 'player' as const, trackId: decodeURIComponent(m[1]), listId: m[2] ? decodeURIComponent(m[2]) : 'all' }
    : { page: 'library' as const }
}

export interface PlaylistActions {
  create: (name: string, trackIds?: string[]) => Promise<Playlist>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setTracks: (id: string, trackIds: string[]) => Promise<void>
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([])
  const [loaded, setLoaded] = useState(false)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [route, setRoute] = useState(readHash)
  const [listId, setListId] = useState('all')

  const refreshTracks = useCallback(() => db.listTracks().then(setTracks), [])
  const refreshPlaylists = useCallback(() => db.listPlaylists().then(setPlaylists), [])
  const queue = useSeparationQueue(refreshTracks)

  useEffect(() => {
    Promise.all([refreshTracks(), refreshPlaylists()]).then(() => setLoaded(true))
  }, [refreshTracks, refreshPlaylists])

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const deleteTrack = async (track: Track) => {
    if (!confirm(`Excluir "${track.title}" do aparelho?`)) return
    await db.deleteTrack(track)
    await Promise.all([refreshTracks(), refreshPlaylists()])
  }

  const renameTrack = async (track: Track) => {
    const title = prompt('Título:', track.title)?.trim()
    if (!title) return
    const artist = prompt('Artista:', track.artist)?.trim() ?? track.artist
    await db.updateTrack({ ...track, title, artist })
    await refreshTracks()
  }

  const playlistActions: PlaylistActions = {
    create: async (name, trackIds = []) => {
      const pl: Playlist = { id: crypto.randomUUID().slice(0, 8), name, track_ids: trackIds, created_at: Date.now() }
      await db.savePlaylist(pl)
      await refreshPlaylists()
      return pl
    },
    rename: async (id, name) => {
      const pl = playlists.find((p) => p.id === id)
      if (pl) await db.savePlaylist({ ...pl, name })
      await refreshPlaylists()
    },
    remove: async (id) => {
      await db.deletePlaylist(id)
      if (listId === id) setListId('all')
      await refreshPlaylists()
    },
    setTracks: async (id, trackIds) => {
      const pl = playlists.find((p) => p.id === id)
      if (!pl) return
      const next = { ...pl, track_ids: [...new Set(trackIds)] }
      setPlaylists((prev) => prev.map((p) => (p.id === id ? next : p)))
      await db.savePlaylist(next)
    },
  }

  const listTracks = useCallback(
    (id: string) => {
      if (id === 'all') return tracks
      const pl = playlists.find((p) => p.id === id)
      if (!pl) return tracks
      return pl.track_ids.map((tid) => tracks.find((t) => t.id === tid)).filter((t): t is Track => !!t)
    },
    [tracks, playlists],
  )

  const current = route.page === 'player' ? tracks.find((t) => t.id === route.trackId) ?? null : null
  const playerList = route.page === 'player' ? route.listId : 'all'
  const playerQueue = useMemo(() => listTracks(playerList), [listTracks, playerList])

  const openTrack = (track: Track, list = listId) => {
    location.hash = `#/play/${encodeURIComponent(track.id)}?list=${encodeURIComponent(list)}`
  }

  if (route.page === 'settings') return <Settings onBack={() => (location.hash = '')} />

  if (current) {
    return (
      <Player
        key={current.id}
        track={current}
        queue={playerQueue}
        onBack={() => (location.hash = '')}
        onSelect={(t) => openTrack(t, playerList)}
      />
    )
  }

  return (
    <Library
      loaded={loaded}
      tracks={tracks}
      playlists={playlists}
      jobs={queue.jobs}
      listId={listId}
      onListChange={setListId}
      listTracks={listTracks}
      onAddFiles={queue.add}
      onCancelJob={queue.cancel}
      onDismissJob={queue.dismiss}
      onOpen={openTrack}
      onRename={renameTrack}
      onDelete={deleteTrack}
      playlistActions={playlistActions}
    />
  )
}
