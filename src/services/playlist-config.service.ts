import { dirname, join } from '@tauri-apps/api/path'
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import { buildMetadataAppliedPayload } from './id3-tags.service'
import type {
  PlaylistJsonRoot,
  PlaylistRunState,
  PlaylistTrack,
  SkippedPlaylistTrack
} from '../lib/types/playlist.types'
import { safePlaylistDirName } from '../lib/safe-playlist-dir-name'

const REQUIRED_TRACK_KEYS = [
  'fileName',
  'artist',
  'album',
  'trackNumber',
  'title',
  'videoUrl'
] as const satisfies readonly (keyof PlaylistTrack)[]

export function assertPlaylistConfigShape(configJson: unknown): asserts configJson is PlaylistJsonRoot {
  if (!configJson || typeof configJson !== 'object') {
    throw new Error('Invalid config root object.')
  }
  const root = configJson as Record<string, unknown>
  if (!root.playlist || String(root.playlist).trim() === '') {
    throw new Error('Config must include non-empty root "playlist" (folder name under out).')
  }
  if (!Array.isArray(root.tracks) || root.tracks.length === 0) {
    throw new Error("Config must include a non-empty 'tracks' array.")
  }
  root.tracks.forEach((track, index) => {
    if (!track || typeof track !== 'object') {
      throw new Error(`tracks[${index}] must be an object`)
    }
    const t = track as Record<string, unknown>
    for (const key of REQUIRED_TRACK_KEYS) {
      const value = t[key]
      if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`tracks[${index}] must include non-empty "${key}"`)
      }
    }
  })
}

export function parsePlaylistJson(text: string): unknown {
  return JSON.parse(text) as unknown
}

export interface ResolvedPlaylistPaths {
  configDir: string
  baseOut: string
  playlistDir: string
  outRelative: string
  playlistLabel: string
  rootCoverPath: string
  coverAbsolutePath: string | null
  tracks: PlaylistTrack[]
}

/**
 * Resuelve rutas de salida cuando el JSON no está en disco: `configDir` es la carpeta base
 * (p. ej. `~/Downloads/music-app`) y `out` del JSON es relativo a esa base.
 */
export async function resolvePlaylistPathsFromConfigDir(
  configDir: string,
  root: PlaylistJsonRoot,
  opts?: { coverAbsolutePath?: string | null }
): Promise<ResolvedPlaylistPaths> {
  const hasOutKey = Object.prototype.hasOwnProperty.call(root, 'out')
  let outRelative: string
  let baseOut: string
  if (!hasOutKey || root.out === undefined || root.out === null) {
    outRelative = 'downloads'
    baseOut = await join(configDir, 'downloads')
  } else {
    const trimmed = String(root.out).trim()
    if (trimmed === '' || trimmed === '.') {
      outRelative = '.'
      baseOut = configDir
    } else {
      outRelative = trimmed
      baseOut = await join(configDir, trimmed)
    }
  }
  const playlistLabel = String(root.playlist).trim()
  const playlistFolder = safePlaylistDirName(playlistLabel)
  const playlistDir = await join(baseOut, playlistFolder)
  const rootCoverPath = root.coverPath ? String(root.coverPath).trim() : ''
  const coverAbsolutePath = opts?.coverAbsolutePath?.trim() || null

  await mkdir(baseOut, { recursive: true })
  await mkdir(playlistDir, { recursive: true })

  return {
    configDir,
    baseOut,
    playlistDir,
    outRelative,
    playlistLabel,
    rootCoverPath,
    coverAbsolutePath,
    tracks: root.tracks as PlaylistTrack[]
  }
}

export async function resolvePlaylistPaths(
  configPath: string,
  root: PlaylistJsonRoot
): Promise<ResolvedPlaylistPaths> {
  const configDir = await dirname(configPath)
  return resolvePlaylistPathsFromConfigDir(configDir, root)
}

export function createInitialPlaylistRunState(
  resolved: ResolvedPlaylistPaths
): PlaylistRunState {
  const tracksSnapshot = resolved.tracks.map((t) => {
    const { draftId: _d, ...rest } = t
    return rest as PlaylistTrack
  })
  return {
    playlistLabel: resolved.playlistLabel,
    outRelative: resolved.outRelative,
    configDir: resolved.configDir,
    rootCoverPath: resolved.rootCoverPath,
    coverAbsolutePath: resolved.coverAbsolutePath,
    tracksSnapshot,
    skippedTracks: [] as SkippedPlaylistTrack[]
  }
}

export async function writePlaylistMetadataApplied(
  playlistDir: string,
  state: PlaylistRunState
): Promise<void> {
  const summaryPath = await join(playlistDir, 'metadata.applied.json')
  const payload = buildMetadataAppliedPayload(
    state.playlistLabel,
    state.outRelative,
    state.rootCoverPath,
    state.coverAbsolutePath,
    state.skippedTracks,
    state.tracksSnapshot
  )
  await writeTextFile(summaryPath, JSON.stringify(payload, null, 2))
}
