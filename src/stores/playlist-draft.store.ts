import { writable } from 'svelte/store'
import type { PlaylistTrack } from '../lib/types/playlist.types'

export interface DraftTrack extends PlaylistTrack {
  draftId: string
}

export interface PlaylistDraftState {
  sourceUrl: string
  /** Nombre elegido por el usuario (carpeta + álbum ID3). */
  playlistName: string
  /** Título devuelto por yt-dlp (referencia). */
  playlistLabel: string
  /** Ruta absoluta a imagen de portada para los MP3; null si no hay. */
  coverImagePath: string | null
  tracks: DraftTrack[]
  loading: boolean
  error: string | null
}

const initial: PlaylistDraftState = {
  sourceUrl: '',
  playlistName: '',
  playlistLabel: '',
  coverImagePath: null,
  tracks: [],
  loading: false,
  error: null
}

export const playlistDraftStore = writable<PlaylistDraftState>(initial)

export function resetPlaylistDraft(): void {
  playlistDraftStore.set({ ...initial })
}

function renumberDraftTracks(tracks: DraftTrack[]): DraftTrack[] {
  const n = tracks.length
  return tracks.map((t, i) => ({
    ...t,
    trackNumber: `${i + 1}/${n || 1}`
  }))
}

export function removeDraftTrackById(draftId: string): void {
  playlistDraftStore.update((s) => {
    const tracks = renumberDraftTracks(s.tracks.filter((t) => t.draftId !== draftId))
    return { ...s, tracks }
  })
}

export function clearDraftCoverImage(): void {
  playlistDraftStore.update((s) => ({ ...s, coverImagePath: null }))
}
