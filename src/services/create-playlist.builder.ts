/**
 * Lógica portada de `create.playlist.js`: parseo del dump `-J` de yt-dlp y construcción de pistas.
 */

import type { PlaylistTrack } from '../lib/types/playlist.types'

export interface YtdlpFlatEntry {
  id?: string
  title?: string
  webpage_url?: string
  url?: string
  uploader?: string
  channel?: string
}

export interface YtdlpDumpRoot {
  _type?: string
  title?: string
  playlist?: string
  id?: string
  entries?: YtdlpFlatEntry[]
}

function escapeRegExp(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripParenthesesAndBrackets(s: string): string {
  let out = String(s || '')
  let prev: string
  do {
    prev = out
    out = out.replace(/\([^()]*\)/g, '').replace(/\[[^\[\]]*\]/g, '')
  } while (out !== prev)
  return out.replace(/\s+/g, ' ').trim()
}

export function stripRedundantArtistFromTitle(title: string, artist: string): string {
  let t = String(title || '').trim()
  const a = String(artist || '').trim()
  if (!t || !a || a.length < 2 || /^unknown$/i.test(a)) return t
  const arx = escapeRegExp(a)
  let prev: string
  do {
    prev = t
    t = t
      .replace(new RegExp(`^${arx}\\s*(?:[-–—|:]|\\bvs\\.?\\b)\\s*`, 'i'), '')
      .replace(new RegExp(`^${arx}\\s+`, 'i'), '')
      .replace(new RegExp(`\\s+(?:feat\\.?|ft\\.?|featuring|con)\\s*${arx}\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s*(?:[-–—|:]|\\bvs\\.?\\b)\\s*${arx}$`, 'i'), '')
      .replace(/\s+/g, ' ')
      .trim()
  } while (t !== prev)
  return t
}

/** Normaliza para comparar título de vídeo con el canal / playlist (orden «canción - artista»). */
function normForArtistCompare(s: string): string {
  return stripParenthesesAndBrackets(String(s || ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * YouTube suele usar «Artista - Canción» pero también «Canción - Artista».
 * Si la parte que coincide con el canal/uploader es la derecha, intercambiamos.
 */
function orderDashParts(
  left: string,
  right: string,
  fallbackArtist: string
): { artist: string; title: string } {
  const ch = String(fallbackArtist || '').trim()
  if (ch.length >= 2 && !/^unknown$/i.test(ch)) {
    const nl = normForArtistCompare(left)
    const nr = normForArtistCompare(right)
    const nc = normForArtistCompare(ch)
    if (nr === nc) return { artist: right.trim(), title: left.trim() }
    if (nl === nc) return { artist: left.trim(), title: right.trim() }
  }
  return { artist: left.trim(), title: right.trim() }
}

export function splitArtistTitle(
  rawTitle: string,
  fallbackArtist: string
): { artist: string; title: string } {
  const cleaned = String(rawTitle || '').trim() || 'Unknown'
  const fallback = String(fallbackArtist || '').trim() || 'Unknown'

  const dash = cleaned.match(/^(.{1,120}?)\s+-\s+(.+)$/)
  if (dash) {
    return orderDashParts(dash[1], dash[2], fallback)
  }

  const unicodeDash = cleaned.match(/^(.{1,120}?)\s+[–—]\s+(.+)$/)
  if (unicodeDash) {
    return orderDashParts(unicodeDash[1], unicodeDash[2], fallback)
  }

  const colon = cleaned.match(/^([^:]+):\s*(.+)$/)
  if (colon) {
    const left = colon[1].trim()
    const right = colon[2].trim()
    const looksLikeTime =
      /^[\d:]+$/.test(left) || /^[\d:]+$/.test(`${left}:${right.split(':')[0]}`)
    const hasLetter = /[a-zA-Z\u00C0-\u024F]/.test(left)
    if (!looksLikeTime && hasLetter && left.length >= 2 && right.length >= 1 && left.length <= 120) {
      return { artist: left, title: right }
    }
  }

  return { artist: fallback, title: cleaned }
}

export function finalizeTrackTitle(
  rawTitle: string,
  fallbackArtist: string
): { artist: string; title: string } {
  const split = splitArtistTitle(rawTitle, fallbackArtist)
  let title = stripParenthesesAndBrackets(split.title)
  title = stripRedundantArtistFromTitle(title, split.artist)
  title = title.replace(/\s+/g, ' ').trim()
  if (!title) title = 'Unknown'
  return { artist: split.artist, title }
}

export function watchUrlFromEntry(entry: YtdlpFlatEntry): string {
  const id = entry.id ? String(entry.id).trim() : ''
  const webpage = entry.webpage_url ? String(entry.webpage_url).trim() : ''
  const directUrl = entry.url ? String(entry.url).trim() : ''

  if (webpage && /youtube\.com\/watch\?v=|youtu\.be\//i.test(webpage)) {
    try {
      const u = new URL(webpage)
      const v = u.searchParams.get('v')
      if (v) return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`
    } catch {
      /* ignore */
    }
    return webpage
  }
  if (directUrl && /^https?:\/\//i.test(directUrl)) return directUrl
  if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
  return ''
}

export function safeFileBase(name: unknown): string {
  let s = String(name ?? 'track').trim() || 'track'
  s = s.replace(/_[A-Za-z0-9_-]{11}$/, '')
  s = s
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/[_\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/g, '')
  if (!s || s === '.' || s === '..') s = 'track'
  return s.slice(0, 180)
}

export function collectEntries(root: YtdlpDumpRoot): YtdlpFlatEntry[] {
  if (!root || typeof root !== 'object') return []
  if (root._type === 'playlist' && Array.isArray(root.entries)) {
    return root.entries.filter((e) => e && e.id)
  }
  if (root._type === 'video' && root.id) {
    return [root as YtdlpFlatEntry]
  }
  if (Array.isArray(root.entries) && root.entries.length) {
    return root.entries.filter((e) => e && e.id)
  }
  throw new Error(
    'Unexpected yt-dlp JSON shape: expected playlist with entries or a single video object.'
  )
}

export function buildTracksFromDump(root: YtdlpDumpRoot, entries: YtdlpFlatEntry[]): PlaylistTrack[] {
  const playlistName =
    String(root.title || root.playlist || 'Unknown Playlist').trim() || 'Unknown Playlist'
  const usedStemCount = new Map<string, number>()

  return entries.map((entry, index) => {
    const rawTitle = String(entry.title || '').trim() || 'Unknown'
    const channel = String(entry.uploader || entry.channel || '').trim()
    const { artist, title } = finalizeTrackTitle(rawTitle, channel || playlistName)
    const videoUrl = watchUrlFromEntry(entry)

    const stem = safeFileBase(title)
    const n = (usedStemCount.get(stem) || 0) + 1
    usedStemCount.set(stem, n)
    const base = n === 1 ? stem : `${stem} ${n}`
    const fileName = `${base}.mp3`

    return {
      fileName,
      artist,
      album: playlistName,
      trackNumber: `${index + 1}/${entries.length}`,
      title,
      videoUrl,
      youtubeTitle: rawTitle,
      youtubeId: String(entry.id || '')
    }
  })
}

export function playlistLabelFromDump(root: YtdlpDumpRoot): string {
  return String(root.title || root.playlist || 'Unknown Playlist').trim() || 'Unknown Playlist'
}
