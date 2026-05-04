const INVALID = /[/\\:*?"<>|\u0000-\u001F]/g
const RESERVED_WIN = /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i

/**
 * Elimina caracteres inválidos en Windows / macOS / Linux y recorta espacios.
 */
export function sanitizeFileNameSegment(name: string): string {
  const cleaned = name.replace(INVALID, '_').replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'track'
  if (RESERVED_WIN.test(cleaned)) return `_${cleaned}`
  return cleaned
}

/**
 * Asegura extensión `.mp3` y sanea el nombre base.
 */
export function sanitizeMp3FileName(fileName: string): string {
  const base = sanitizeFileNameSegment(fileName.replace(/\.mp3$/i, ''))
  return `${base}.mp3`
}
