/** Ciclo de vida de una tarea en cola (lista para concurrencia futura). */
export type DownloadStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** Fragmento parseado de una línea `[download] …` de yt-dlp. */
export interface DownloadProgress {
  /** Porcentaje 0–100 cuando se conoce. */
  percent: number | null
  /** Texto de tamaño total si aparece en la línea. */
  totalSizeLabel: string | null
  /** Velocidad literal (ej. `1.2MiB/s`, `Unknown B/s`). */
  speed: string | null
  /** ETA literal o tiempo `in …` según formato. */
  eta: string | null
  /** Línea original (útil para depuración / logs). */
  rawLine: string
}

/** Entrada de trabajo para la cola de descargas. */
export interface DownloadTask {
  readonly id: string
  /** Título legible en UI. */
  readonly title: string
  /** URL de origen (puede incluir `list=`; se normaliza al ejecutar). */
  readonly sourceUrl: string
  /** Nombre de archivo deseado (debe terminar en `.mp3` o se fuerza). */
  readonly fileName: string
  /** Metadatos ID3 (p. ej. importación desde playlist JSON). */
  readonly artist?: string
  readonly album?: string
  readonly trackNumber?: string | number
  /** Enlace a la fila del borrador (`playlist-draft`). */
  readonly draftId?: string
  status: DownloadStatus
  progress: DownloadProgress | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

/** Payload al terminar un spawn de yt-dlp. */
export interface YtdlpExitInfo {
  code: number | null
  signal: number | null
}

/** Entrada mínima para crear tareas (sin id ni timestamps). */
export type DownloadTaskInput = Pick<DownloadTask, 'title' | 'sourceUrl' | 'fileName'> &
  Partial<Pick<DownloadTask, 'artist' | 'album' | 'trackNumber' | 'draftId'>>
