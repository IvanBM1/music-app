import { writable, get } from 'svelte/store'
import type { DownloadTask, DownloadTaskInput } from '../lib/types/downloads.types'
import { sanitizeMp3FileName } from '../lib/sanitize-filename'

const MAX_LOG_LINES = 2500

export interface DownloadsStoreState {
  /** Directorio absoluto de salida; `null` = usar default del servicio. */
  outputDir: string | null
  /**
   * Ruta absoluta a cookies Netscape para YouTube (exportadas desde el navegador).
   * Mitiga «Sign in to confirm you're not a bot» en yt-dlp.
   */
  ytdlpCookiesPath: string | null
  tasks: DownloadTask[]
  activeTaskId: string | null
  isProcessing: boolean
  logLines: string[]
}

const initialState: DownloadsStoreState = {
  outputDir: null,
  ytdlpCookiesPath: null,
  tasks: [],
  activeTaskId: null,
  isProcessing: false,
  logLines: []
}

export const downloadsStore = writable<DownloadsStoreState>(initialState)

function trimLog(lines: string[]): string[] {
  if (lines.length <= MAX_LOG_LINES) return lines
  return lines.slice(lines.length - MAX_LOG_LINES)
}

export function createDownloadTask(input: DownloadTaskInput): DownloadTask {
  const fileName = sanitizeMp3FileName(input.fileName)
  return {
    id: crypto.randomUUID(),
    title: input.title,
    sourceUrl: input.sourceUrl,
    fileName,
    ...(input.artist?.trim() ? { artist: input.artist.trim() } : {}),
    ...(input.album?.trim() ? { album: input.album.trim() } : {}),
    ...(input.trackNumber !== undefined && input.trackNumber !== null && String(input.trackNumber).trim() !== ''
      ? { trackNumber: input.trackNumber }
      : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
    status: 'queued',
    progress: null,
    error: null,
    startedAt: null,
    completedAt: null
  }
}

export function getDownloadsState(): DownloadsStoreState {
  return get(downloadsStore)
}

export function setDownloadsOutputDir(path: string | null): void {
  downloadsStore.update((s) => ({ ...s, outputDir: path }))
}

export function setYtdlpCookiesPath(path: string | null): void {
  downloadsStore.update((s) => ({ ...s, ytdlpCookiesPath: path?.trim() ? path.trim() : null }))
}

export function setDownloadsProcessing(active: boolean): void {
  downloadsStore.update((s) => ({ ...s, isProcessing: active }))
}

export function setActiveTaskId(id: string | null): void {
  downloadsStore.update((s) => ({ ...s, activeTaskId: id }))
}

export function replaceDownloadTasks(tasks: DownloadTask[]): void {
  downloadsStore.update((s) => ({ ...s, tasks: [...tasks] }))
}

export function appendDownloadTasks(tasks: DownloadTask[]): void {
  downloadsStore.update((s) => ({ ...s, tasks: [...s.tasks, ...tasks] }))
}

export function patchDownloadTask(id: string, patch: Partial<DownloadTask>): void {
  downloadsStore.update((s) => ({
    ...s,
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
  }))
}

/** Quita la tarea asociada a una fila del borrador (cualquier estado). */
export function removeDownloadTasksByDraftId(draftId: string): void {
  downloadsStore.update((s) => ({
    ...s,
    tasks: s.tasks.filter((t) => t.draftId !== draftId)
  }))
}

export function appendStructuredLog(scope: string, message: string): void {
  const stamp = new Date().toISOString()
  const line = `[${stamp}][${scope}] ${message}`
  downloadsStore.update((s) => ({
    ...s,
    logLines: trimLog([...s.logLines, line])
  }))
}

export function clearDownloadLogs(): void {
  downloadsStore.update((s) => ({ ...s, logLines: [] }))
}

export function resetDownloadsStore(): void {
  downloadsStore.set({ ...initialState })
}
