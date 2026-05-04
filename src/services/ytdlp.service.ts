import { Command } from '@tauri-apps/plugin-shell'
import { exists } from '@tauri-apps/plugin-fs'
import type { YtdlpExitInfo } from '../lib/types/downloads.types'

export const YTDLP_SIDECAR = 'bin/yt-dlp' as const

export interface YtdlpSpawnCallbacks {
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

export interface YtdlpRunHandle {
  readonly pid: number
  kill(): Promise<void>
  readonly completion: Promise<YtdlpExitInfo>
}

function createLineSplitter(onLine: (line: string) => void) {
  let buf = ''
  return {
    push(chunk: string) {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const p of parts) {
        if (p.length) onLine(p)
      }
    },
    flush() {
      if (buf.trim().length) {
        onLine(buf)
        buf = ''
      }
    }
  }
}

/**
 * Prefijo `--cookies RUTA` si el archivo existe (mitiga «Sign in to confirm you're not a bot» en YouTube).
 */
export async function cookiesArgsForYtdlp(cookiesPath: string | null | undefined): Promise<string[]> {
  const p = cookiesPath?.trim()
  if (!p) return []
  try {
    if (await exists(p)) return ['--cookies', p]
  } catch {
    /* sin acceso al path */
  }
  return []
}

/**
 * Construye argumentos con flags recomendados para audio MP3 embebido.
 * @param leadingExtras p. ej. resultado de `await cookiesArgsForYtdlp(...)` (debe ir tras `--ffmpeg-location`).
 */
export function buildYtdlpAudioArgs(
  ffmpegDir: string,
  outputTemplate: string,
  videoUrl: string,
  leadingExtras: string[] = []
): string[] {
  return [
    '--ffmpeg-location',
    ffmpegDir,
    ...leadingExtras,
    '--newline',
    '--progress',
    '--no-playlist',
    '--restrict-filenames',
    '--embed-metadata',
    '--embed-thumbnail',
    '-x',
    '--audio-format',
    'mp3',
    '-o',
    outputTemplate,
    videoUrl
  ]
}

/** Solo los primeros ~90 s: mucho menos datos que el tema completo antes de reproducir. */
const PREVIEW_AUDIO_SECTION = '*0:00-1:30'

/** Descarga rápida MP3 temporal para escuchar en el webview (sin metadatos incrustados). */
export function buildYtdlpPreviewAudioArgs(
  ffmpegDir: string,
  outputTemplate: string,
  videoUrl: string,
  leadingExtras: string[] = []
): string[] {
  return [
    '--ffmpeg-location',
    ffmpegDir,
    ...leadingExtras,
    '--no-warnings',
    '--no-playlist',
    '--download-sections',
    PREVIEW_AUDIO_SECTION,
    '-x',
    '--audio-format',
    'mp3',
    '-o',
    outputTemplate,
    videoUrl
  ]
}

/**
 * Lanza el sidecar yt-dlp con `spawn()`, emite líneas completas y permite `kill()`.
 */
const STDERR_TAIL_MAX_LINES = 48
const STDERR_TAIL_MAX_CHARS = 4000

function pushStderrLine(lines: string[], line: string) {
  lines.push(line)
  while (lines.length > STDERR_TAIL_MAX_LINES) lines.shift()
}

function stderrLinesToTail(lines: string[]): string {
  let s = lines.join('\n').trimEnd()
  if (s.length > STDERR_TAIL_MAX_CHARS) s = s.slice(-STDERR_TAIL_MAX_CHARS)
  return s
}

export async function spawnYtdlp(
  args: string[],
  callbacks: YtdlpSpawnCallbacks = {}
): Promise<YtdlpRunHandle> {
  const cmd = Command.sidecar(YTDLP_SIDECAR, args)
  const stderrTailLines: string[] = []

  const out = createLineSplitter((line) => callbacks.onStdoutLine?.(line))
  const err = createLineSplitter((line) => {
    pushStderrLine(stderrTailLines, line)
    callbacks.onStderrLine?.(line)
  })

  cmd.stdout.on('data', (chunk: string) => {
    out.push(chunk)
  })
  cmd.stderr.on('data', (chunk: string) => {
    err.push(chunk)
  })

  const completion = new Promise<YtdlpExitInfo>((resolve, reject) => {
    cmd.once('error', (msg: string) => {
      reject(new Error(msg || 'shell spawn error'))
    })
    cmd.once('close', (payload: { code: number | null; signal: number | null }) => {
      out.flush()
      err.flush()
      resolve({
        code: payload.code,
        signal: payload.signal,
        stderrTail: stderrLinesToTail(stderrTailLines)
      })
    })
  })

  const child = await cmd.spawn()

  return {
    pid: child.pid,
    kill: () => child.kill(),
    completion
  }
}

/**
 * Ejecuta yt-dlp y devuelve stdout completo (p. ej. `-J` / dump JSON). No trocea por líneas.
 */
export async function spawnYtdlpCollectStdout(args: string[]): Promise<string> {
  const cmd = Command.sidecar(YTDLP_SIDECAR, args)
  let stdout = ''
  let stderr = ''
  const stderrTailLines: string[] = []
  const errSplit = createLineSplitter((line) => pushStderrLine(stderrTailLines, line))

  cmd.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  cmd.stderr.on('data', (chunk: string) => {
    stderr += chunk
    errSplit.push(chunk)
  })

  const completion = new Promise<YtdlpExitInfo>((resolve, reject) => {
    cmd.once('error', (msg: string) => {
      reject(new Error(msg || 'shell spawn error'))
    })
    cmd.once('close', (payload: { code: number | null; signal: number | null }) => {
      errSplit.flush()
      resolve({
        code: payload.code,
        signal: payload.signal,
        stderrTail: stderrLinesToTail(stderrTailLines) || stderr.trim().slice(-STDERR_TAIL_MAX_CHARS)
      })
    })
  })

  await cmd.spawn()
  const exit = await completion
  if (exit.code !== 0) {
    throw new Error(
      `yt-dlp exited with code ${exit.code}\n${stderr.trim().slice(0, 2000) || stdout.slice(0, 2000) || 'No output'}`
    )
  }
  return stdout
}
