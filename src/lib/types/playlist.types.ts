/** Una pista según `download.playlist.js` / playlist JSON. */
export interface PlaylistTrack {
  fileName: string
  artist: string
  album: string
  trackNumber: string | number
  title: string
  videoUrl: string
  /** Metadatos extra de `create.playlist.js` (opcional en JSON guardado). */
  youtubeTitle?: string
  youtubeId?: string
  /** Solo flujo borrador → descarga; no forma parte del JSON importado. */
  draftId?: string
}

/** Raíz del JSON de playlist (mismo contrato que el script Node). */
export interface PlaylistJsonRoot {
  playlist: string
  tracks: PlaylistTrack[]
  /**
   * Relativo al directorio del JSON (import) o a `~/Downloads/music-app` (borrador YouTube).
   * Por defecto `downloads`. Usa `.` o cadena vacía para guardar la playlist directamente bajo la base
   * (`…/music-app/<nombre playlist>/` con el nombre ya saneado).
   */
  out?: string
  /** Relativo al directorio del archivo JSON. */
  coverPath?: string
  /** URL de origen usada al generar la lista (`create.playlist.js`). */
  sourceUrl?: string
}

export interface SkippedPlaylistTrack {
  index: number
  fileName: string
  title: string
  videoUrl: string
  error: string
}

export interface PlaylistRunState {
  playlistLabel: string
  outRelative: string
  configDir: string
  rootCoverPath: string
  /** Imagen de portada ID3; ruta absoluta (p. ej. elegida en el diálogo). */
  coverAbsolutePath: string | null
  tracksSnapshot: PlaylistTrack[]
  skippedTracks: SkippedPlaylistTrack[]
}
