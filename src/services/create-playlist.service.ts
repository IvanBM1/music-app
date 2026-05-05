import { get } from 'svelte/store'
import { open } from '@tauri-apps/plugin-dialog'
import { downloadDir, join } from '@tauri-apps/api/path'
import { appendStructuredLog, getDownloadsState } from '../stores/downloads.store'
import type { PlaylistJsonRoot, PlaylistTrack } from '../lib/types/playlist.types'
import {
  playlistDraftStore,
  renumberDraftTracks,
  type DraftTrack
} from '../stores/playlist-draft.store'
import {
  buildTracksFromDump,
  collectEntries,
  playlistLabelFromDump,
  type YtdlpDumpRoot
} from './create-playlist.builder'
import { resolvePlaylistPathsFromConfigDir } from './playlist-config.service'
import { spawnYtdlpCollectStdout, ytDlpPreambleArgs } from './ytdlp.service'
import { enqueueResolvedPlaylist, startSerialDownloads } from './downloads.service'

function buildDumpArgs(url: string): string[] {
  return [
    '-J',
    '--flat-playlist',
    '--no-warnings',
    '--ignore-errors',
    '--skip-download',
    '--no-progress',
    url
  ]
}

/**
 * Lee la URL del store, ejecuta yt-dlp `-J` y rellena la vista previa editable.
 */
export async function loadYoutubePlaylistIntoDraft(): Promise<void> {
  const st = get(playlistDraftStore)
  const url = st.sourceUrl.trim()
  if (!url) {
    playlistDraftStore.update((s) => ({ ...s, error: 'Indica una URL de YouTube (playlist o vídeo).' }))
    return
  }

  const rawLimit = st.listFetchLimit.trim()
  let maxEntries: number | null = null
  if (rawLimit !== '') {
    const n = Number.parseInt(rawLimit, 10)
    if (!Number.isFinite(n) || n < 1) {
      playlistDraftStore.update((s) => ({
        ...s,
        error: 'El límite debe ser un número entero mayor que cero (o déjalo vacío para cargar todo).'
      }))
      return
    }
    maxEntries = n
  }

  playlistDraftStore.update((s) => ({ ...s, loading: true, error: null }))

  try {
    const preamble = await ytDlpPreambleArgs(getDownloadsState().ytdlpCookiesPath)
    const stdout = await spawnYtdlpCollectStdout([...preamble, ...buildDumpArgs(url)])
    let root: YtdlpDumpRoot
    try {
      root = JSON.parse(stdout) as YtdlpDumpRoot
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`Could not parse yt-dlp JSON: ${msg}\n${stdout.slice(0, 500)}`)
    }

    let entries = collectEntries(root)
    if (entries.length === 0) {
      throw new Error('No videos found for that URL.')
    }
    if (maxEntries != null) {
      entries = entries.slice(0, maxEntries)
    }

    const built = buildTracksFromDump(root, entries)
    const label = playlistLabelFromDump(root)
    const newTracks: DraftTrack[] = built.map((t) => ({ ...t, draftId: crypto.randomUUID() }))
    const priorTracks = get(playlistDraftStore).tracks
    const merged = renumberDraftTracks([...priorTracks, ...newTracks])

    playlistDraftStore.update((s) => ({
      ...s,
      loading: false,
      playlistLabel: label,
      playlistName: s.playlistName.trim() ? s.playlistName : label,
      tracks: merged
    }))
    appendStructuredLog(
      'create-playlist',
      `Listado: +${newTracks.length} vídeo(s) (total borrador ${merged.length}) — ${label}`
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    playlistDraftStore.update((s) => ({
      ...s,
      loading: false,
      error: msg
    }))
    appendStructuredLog('create-playlist', `Error: ${msg}`)
  }
}

/**
 * Pasa la lista editada a la cola de descargas (mismo flujo que JSON importado).
 */
export async function commitDraftToDownloadQueue(): Promise<boolean> {
  const st = get(playlistDraftStore)
  const name = st.playlistName.trim()
  if (!name) {
    appendStructuredLog('create-playlist', 'Indica el nombre de la playlist.')
    playlistDraftStore.update((s) => ({ ...s, error: 'Indica el nombre de la playlist.' }))
    return false
  }

  playlistDraftStore.update((s) => ({ ...s, error: null }))

  const validTracks = st.tracks.filter((t) => String(t.videoUrl).trim())
  if (!validTracks.length) {
    appendStructuredLog('create-playlist', 'No hay pistas con URL de vídeo válida.')
    return false
  }

  const n = validTracks.length
  const renumbered: PlaylistTrack[] = validTracks.map((t, i) => ({
    ...t,
    album: name,
    trackNumber: `${i + 1}/${n}`
  }))

  const root: PlaylistJsonRoot = {
    playlist: name,
    /** Carpeta de salida = `~/Downloads/music-app/<nombre playlist>/` (nombre saneado). */
    out: '.',
    ...(st.sourceUrl.trim() ? { sourceUrl: st.sourceUrl.trim() } : {}),
    tracks: renumbered
  }

  const configBase = await join(await downloadDir(), 'music-app')
  const resolved = await resolvePlaylistPathsFromConfigDir(configBase, root, {
    coverAbsolutePath: st.coverImagePath
  })
  enqueueResolvedPlaylist(resolved)
  appendStructuredLog(
    'create-playlist',
    `Lista confirmada: ${renumbered.length} pista(s) → ${resolved.playlistDir}`
  )
  return true
}

/** Encola según el borrador y ejecuta las descargas en serie (misma lista que la UI). */
export async function downloadPlaylistFromDraft(): Promise<boolean> {
  const ok = await commitDraftToDownloadQueue()
  if (!ok) return false
  await startSerialDownloads()
  return true
}

/** Diálogo para elegir imagen de portada (JPEG/PNG/WebP/GIF). */
export async function pickDraftCoverImage(): Promise<boolean> {
  const picked = await open({
    title: 'Portada para los MP3',
    multiple: false,
    directory: false,
    filters: [
      { name: 'Imagen', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
      { name: 'Todos', extensions: ['*'] }
    ]
  })
  if (typeof picked !== 'string' || !picked.trim()) return false
  playlistDraftStore.update((s) => ({ ...s, coverImagePath: picked.trim() }))
  appendStructuredLog('create-playlist', `Portada: ${picked.trim()}`)
  return true
}
