/**
 * Nombre de carpeta seguro para la playlist (misma lógica que `safeDirName` del script Node).
 */
export function safePlaylistDirName(name: unknown): string {
  const raw = String(name ?? 'Unknown Playlist').trim() || 'Unknown Playlist'
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'Unknown Playlist'
  return cleaned
}
