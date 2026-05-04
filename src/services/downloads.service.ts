import { open } from '@tauri-apps/plugin-dialog'
import { downloadDir, join } from '@tauri-apps/api/path'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import type { DownloadTask, DownloadTaskInput, YtdlpExitInfo } from '../lib/types/downloads.types'
import type { PlaylistRunState } from '../lib/types/playlist.types'
import { youtubeSingleVideoUrl } from '../lib/youtube-url'
import { resolveBundledFfmpegDirectory } from './ffmpeg.service'
import {
  buildYtdlpAudioArgs,
  ytDlpPreambleArgs,
  spawnYtdlp,
  type YtdlpRunHandle
} from './ytdlp.service'
import { persistYtdlpCookiesPath } from './downloads-persistence.service'
import { parseYtdlpDownloadLine } from './ytdlp-progress.parser'
import { applyId3TagsToTaskFile } from './id3-tags.service'
import { safePlaylistDirName } from '../lib/safe-playlist-dir-name'
import {
  assertPlaylistConfigShape,
  createInitialPlaylistRunState,
  parsePlaylistJson,
  resolvePlaylistPaths,
  writePlaylistMetadataApplied,
  type ResolvedPlaylistPaths
} from './playlist-config.service'
import {
  appendDownloadTasks,
  appendStructuredLog,
  createDownloadTask,
  getDownloadsState,
  patchDownloadTask,
  replaceDownloadTasks,
  setActiveTaskId,
  setDownloadsOutputDir,
  setDownloadsProcessing,
  type DownloadsStoreState
} from '../stores/downloads.store'

let currentRun: YtdlpRunHandle | null = null
let abortRequested = false
/** Estado del lote importado desde JSON (resumen `metadata.applied.json` al terminar). */
let playlistRunState: PlaylistRunState | null = null

/** Solo si no hay carpeta elegida ni cola desde playlist (poco habitual). */
async function defaultOutputDir(): Promise<string> {
  const base = await join(await downloadDir(), 'music-app')
  return join(base, 'downloads', safePlaylistDirName('sin-etiqueta'))
}

async function resolveOutputDir(state: DownloadsStoreState): Promise<string> {
  if (state.outputDir?.trim()) return state.outputDir.trim()
  return defaultOutputDir()
}

function ingestStreamLine(taskId: string, line: string, stream: 'stdout' | 'stderr'): void {
  appendStructuredLog(`${stream}:${taskId.slice(0, 8)}`, line)
  const parsed = parseYtdlpDownloadLine(line)
  if (parsed) {
    patchDownloadTask(taskId, { progress: parsed })
  }
}

function formatYtdlpTaskFailure(exit: YtdlpExitInfo): string {
  const tail = exit.stderrTail?.trim()
  if (tail) return tail.length > 2000 ? `…${tail.slice(-2000)}` : tail
  return `Código salida ${exit.code}, señal ${exit.signal}`
}

function taskQueueIndex(taskId: string): number {
  const idx = getDownloadsState().tasks.findIndex((t) => t.id === taskId)
  return Math.max(1, idx + 1)
}

function recordPlaylistSkipIf(task: DownloadTask, error: string): void {
  if (!playlistRunState) return
  playlistRunState.skippedTracks.push({
    index: taskQueueIndex(task.id),
    fileName: task.fileName,
    title: task.title,
    videoUrl: task.sourceUrl,
    error
  })
}

async function finalizeTaskWithId3(task: DownloadTask, outDir: string): Promise<void> {
  try {
    await applyId3TagsToTaskFile(
      outDir,
      task,
      playlistRunState?.configDir ?? '',
      playlistRunState?.rootCoverPath ?? '',
      playlistRunState?.coverAbsolutePath ?? null
    )
  } catch (e) {
    const firstLine = String(e instanceof Error ? e.message : e).split('\n')[0].trim()
    recordPlaylistSkipIf(task, `tags: ${firstLine}`)
    patchDownloadTask(task.id, {
      status: 'failed',
      error: firstLine,
      completedAt: Date.now(),
      progress: null
    })
    appendStructuredLog('downloads', `Etiquetas fallidas — ${task.title}: ${firstLine}`)
    return
  }
  patchDownloadTask(task.id, {
    status: 'completed',
    error: null,
    completedAt: Date.now(),
    progress: null
  })
  appendStructuredLog('downloads', `Completado — ${task.title}`)
}

async function runSingleTask(task: DownloadTask, outDir: string, ffmpegDir: string): Promise<void> {
  const url = youtubeSingleVideoUrl(task.sourceUrl)
  if (!url) {
    patchDownloadTask(task.id, {
      status: 'failed',
      error: 'URL vacía o no soportada',
      completedAt: Date.now(),
      progress: null
    })
    recordPlaylistSkipIf(task, 'URL vacía o no soportada')
    appendStructuredLog('downloads', `Tarea ${task.id}: URL inválida`)
    return
  }

  const mp3Path = await join(outDir, task.fileName)
  const targetPath = mp3Path
  const outputTpl = `${targetPath.replace(/\.mp3$/i, '')}.%(ext)s`
  const preamble = await ytDlpPreambleArgs(getDownloadsState().ytdlpCookiesPath)
  const args = buildYtdlpAudioArgs(ffmpegDir, outputTpl, url, preamble)

  patchDownloadTask(task.id, {
    status: 'running',
    startedAt: Date.now(),
    error: null,
    progress: null
  })
  setActiveTaskId(task.id)

  let onDisk = false

  if (await exists(mp3Path)) {
    appendStructuredLog('downloads', `Skip download (already exists): ${task.fileName}`)
    onDisk = true
    setActiveTaskId(null)
  } else {
    let handle: YtdlpRunHandle
    try {
      handle = await spawnYtdlp(args, {
        onStdoutLine: (line) => ingestStreamLine(task.id, line, 'stdout'),
        onStderrLine: (line) => ingestStreamLine(task.id, line, 'stderr')
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patchDownloadTask(task.id, {
        status: 'failed',
        error: msg,
        completedAt: Date.now(),
        progress: null
      })
      recordPlaylistSkipIf(task, msg)
      appendStructuredLog('downloads', `spawn error: ${msg}`)
      setActiveTaskId(null)
      return
    }

    currentRun = handle
    appendStructuredLog('downloads', `yt-dlp pid=${handle.pid} — ${task.title}`)

    try {
      const exit = await handle.completion

      if (abortRequested) {
        patchDownloadTask(task.id, {
          status: 'cancelled',
          completedAt: Date.now()
        })
        appendStructuredLog('downloads', `Cancelado — ${task.title}`)
        return
      }

      const ok = exit.code === 0
      if (!ok) {
        const errMsg = formatYtdlpTaskFailure(exit)
        patchDownloadTask(task.id, {
          status: 'failed',
          error: errMsg,
          completedAt: Date.now(),
          progress: null
        })
        recordPlaylistSkipIf(task, errMsg)
        appendStructuredLog('downloads', `Fallo code=${exit.code} — ${task.title}`)
        return
      }
      onDisk = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patchDownloadTask(task.id, {
        status: abortRequested ? 'cancelled' : 'failed',
        error: msg,
        completedAt: Date.now(),
        progress: null
      })
      if (!abortRequested) recordPlaylistSkipIf(task, msg)
      appendStructuredLog('downloads', `Error: ${msg}`)
      return
    } finally {
      currentRun = null
      setActiveTaskId(null)
    }
  }

  if (onDisk && !abortRequested) {
    await finalizeTaskWithId3(task, outDir)
  }
}

function sweepQueuedToCancelled(): void {
  const { tasks } = getDownloadsState()
  for (const t of tasks) {
    if (t.status === 'queued') {
      patchDownloadTask(t.id, { status: 'cancelled', completedAt: Date.now() })
    }
  }
}

/**
 * Sustituye la cola por nuevas tareas (demo). Limpia el contexto de playlist JSON.
 */
export function enqueueDownloadInputs(inputs: DownloadTaskInput[]): void {
  playlistRunState = null
  const tasks = inputs.map((i) => createDownloadTask(i))
  replaceDownloadTasks(tasks)
  appendStructuredLog('queue', `Cola nueva: ${tasks.length} tarea(s)`)
}

/** Añade tareas al final de la cola existente. Limpia contexto playlist. */
export function appendDownloadInputs(inputs: DownloadTaskInput[]): void {
  playlistRunState = null
  const tasks = inputs.map((i) => createDownloadTask(i))
  appendDownloadTasks(tasks)
  appendStructuredLog('queue', `Añadidas ${tasks.length} tarea(s)`)
}

/** Aplica rutas resueltas y reemplaza la cola (import JSON o lista desde URL). */
export function enqueueResolvedPlaylist(resolved: ResolvedPlaylistPaths): void {
  playlistRunState = createInitialPlaylistRunState(resolved)
  setDownloadsOutputDir(resolved.playlistDir)
  const inputs: DownloadTaskInput[] = resolved.tracks.map((t) => ({
    title: t.title,
    sourceUrl: t.videoUrl,
    fileName: t.fileName,
    artist: t.artist,
    album: t.album,
    trackNumber: t.trackNumber,
    ...(t.draftId ? { draftId: t.draftId } : {})
  }))
  const tasks = inputs.map((i) => createDownloadTask(i))
  replaceDownloadTasks(tasks)
  appendStructuredLog('queue', `Cola nueva: ${tasks.length} tarea(s)`)
}

/**
 * Elige un JSON de playlist (mismo formato que `download.playlist.js`), valida,
 * crea carpetas, fija salida y reemplaza la cola.
 */
export async function importPlaylistFromJsonFile(): Promise<boolean> {
  const picked = await open({
    title: 'Archivo playlist JSON',
    multiple: false,
    directory: false,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })
  if (typeof picked !== 'string' || !picked.trim()) return false

  const configPath = picked.trim()
  let text: string
  try {
    text = await readTextFile(configPath)
  } catch (e) {
    appendStructuredLog('playlist', `Lectura: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }

  let raw: unknown
  try {
    raw = parsePlaylistJson(text)
  } catch (e) {
    appendStructuredLog('playlist', `JSON inválido: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }

  try {
    assertPlaylistConfigShape(raw)
  } catch (e) {
    appendStructuredLog('playlist', e instanceof Error ? e.message : String(e))
    return false
  }

  const resolved = await resolvePlaylistPaths(configPath, raw)
  enqueueResolvedPlaylist(resolved)
  appendStructuredLog(
    'playlist',
    `Importadas ${resolved.tracks.length} pista(s) → ${resolved.playlistDir}`
  )
  return true
}

/**
 * Procesa la cola en serie. Listo para sustituir el bucle por un planificador con concurrencia.
 */
export async function startSerialDownloads(): Promise<void> {
  if (getDownloadsState().isProcessing) {
    appendStructuredLog('downloads', 'Ya hay un proceso en curso')
    return
  }

  abortRequested = false
  setDownloadsProcessing(true)

  const snapshotCtx = playlistRunState
  let finishedWithoutAbort = true

  const ffmpegDir = await resolveBundledFfmpegDirectory()
  const outDir = await resolveOutputDir(getDownloadsState())

  appendStructuredLog('downloads', `Salida: ${outDir}`)
  appendStructuredLog('downloads', `ffmpeg dir: ${ffmpegDir}`)

  try {
    while (!abortRequested) {
      const next = getDownloadsState().tasks.find((t) => t.status === 'queued')
      if (!next) break
      await runSingleTask(next, outDir, ffmpegDir)
    }
    if (abortRequested) {
      finishedWithoutAbort = false
      sweepQueuedToCancelled()
    }

    if (snapshotCtx && finishedWithoutAbort) {
      try {
        await writePlaylistMetadataApplied(outDir, snapshotCtx)
        appendStructuredLog('playlist', `Resumen: metadata.applied.json`)
      } catch (e) {
        appendStructuredLog(
          'playlist',
          `metadata.applied.json: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }
  } finally {
    setDownloadsProcessing(false)
    abortRequested = false
    playlistRunState = null
  }
}

/** Cancela: mata yt-dlp activo y deja de encolar el resto. */
export async function requestCancelDownloads(): Promise<void> {
  abortRequested = true
  appendStructuredLog('downloads', 'Cancelación solicitada')
  if (currentRun) {
    try {
      await currentRun.kill()
    } catch (e) {
      appendStructuredLog('downloads', `kill: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

/**
 * Permite elegir carpeta de descargas (extensible vía permisos `fs` si hiciera falta).
 * Devuelve `false` si el usuario cancela el diálogo.
 */
export async function pickDownloadsOutputDirectory(): Promise<boolean> {
  const picked = await open({
    title: 'Carpeta de descargas',
    directory: true,
    multiple: false
  })
  if (typeof picked !== 'string' || !picked.trim()) return false
  setDownloadsOutputDir(picked.trim())
  appendStructuredLog('paths', `outputDir=${picked.trim()}`)
  return true
}

/**
 * Archivo Netscape de cookies para YouTube (ver wiki yt-dlp).
 * Devuelve `false` si el usuario cancela.
 */
export async function pickYtdlpCookiesFile(): Promise<boolean> {
  const picked = await open({
    title: 'Cookies de YouTube (archivo .txt, formato Netscape)',
    multiple: false,
    directory: false,
    filters: [{ name: 'Texto', extensions: ['txt'] }]
  })
  if (typeof picked !== 'string' || !picked.trim()) return false
  await persistYtdlpCookiesPath(picked.trim())
  appendStructuredLog('paths', `ytdlpCookies=${picked.trim()}`)
  return true
}

export async function clearYtdlpCookiesFile(): Promise<void> {
  await persistYtdlpCookiesPath(null)
  appendStructuredLog('paths', 'ytdlpCookies (vacío)')
}
