import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { Buffer } from 'buffer'
import NodeID3 from 'node-id3'
import { youtubeSingleVideoUrl } from '../lib/youtube-url'
import type { PlaylistTrack, SkippedPlaylistTrack } from '../lib/types/playlist.types'
import type { DownloadTask } from '../lib/types/downloads.types'

type Id3Tags = Parameters<typeof NodeID3.write>[0]

function mimeFromCoverPath(coverAbsolutePath: string): string {
  const lower = coverAbsolutePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/jpeg'
}

function buildImageTag(coverAbsolutePath: string, imageBytes: Uint8Array): NonNullable<Id3Tags['image']> {
  return {
    mime: mimeFromCoverPath(coverAbsolutePath),
    type: { id: 3, name: 'front cover' },
    description: 'Cover',
    imageBuffer: Buffer.from(imageBytes)
  }
}

/**
 * Aplica metadatos ID3 al MP3 (equivalente a `applyTags` del script Node).
 * Requiere `artist` en la tarea (p. ej. importación desde playlist JSON).
 */
export async function applyId3TagsToTaskFile(
  playlistDir: string,
  task: DownloadTask,
  configDir: string,
  rootCoverPath: string,
  coverAbsolutePath?: string | null
): Promise<void> {
  if (!task.artist?.trim()) {
    return
  }

  const mp3Path = await join(playlistDir, task.fileName)
  let fileBytes: Uint8Array
  try {
    fileBytes = await readFile(mp3Path)
  } catch {
    console.warn(`Skipping tags, file not found: ${task.fileName}`)
    return
  }

  let existing: Id3Tags = {}
  try {
    existing = NodeID3.read(Buffer.from(fileBytes)) || {}
  } catch {
    existing = {}
  }

  const { raw: _raw, ...kept } = existing as Id3Tags & { raw?: unknown }

  const tags: Id3Tags = {
    ...kept,
    title: task.title,
    artist: task.artist,
    album: task.album ?? '',
    trackNumber: String(task.trackNumber ?? ''),
    comment: {
      language: 'eng',
      text: youtubeSingleVideoUrl(task.sourceUrl) || String(task.sourceUrl)
    }
  }

  const coverFile =
    coverAbsolutePath?.trim() ||
    (rootCoverPath?.trim() ? await join(configDir, rootCoverPath.trim()) : '')
  if (coverFile) {
    try {
      const coverBytes = await readFile(coverFile)
      tags.image = buildImageTag(coverFile, coverBytes)
    } catch {
      console.warn(`Cover not found: ${coverFile}`)
    }
  }

  const out = NodeID3.write(tags, Buffer.from(fileBytes))
  if (!Buffer.isBuffer(out)) {
    console.warn(`Could not write tags: ${mp3Path}`)
    return
  }
  await writeFile(mp3Path, new Uint8Array(out))
  console.log(`Tagged: ${mp3Path}`)
}

/** Construye payload `metadata.applied.json` como el script Node. */
export function buildMetadataAppliedPayload(
  playlistLabel: string,
  outRelative: string,
  rootCoverPath: string,
  coverAbsolutePath: string | null,
  skippedTracks: SkippedPlaylistTrack[],
  tracks: PlaylistTrack[]
): Record<string, unknown> {
  return {
    playlist: playlistLabel,
    out: outRelative,
    ...(rootCoverPath ? { coverPath: rootCoverPath } : {}),
    ...(coverAbsolutePath ? { coverImage: coverAbsolutePath } : {}),
    generatedAt: new Date().toISOString(),
    ...(skippedTracks.length ? { skippedTracks } : {}),
    tracks
  }
}
