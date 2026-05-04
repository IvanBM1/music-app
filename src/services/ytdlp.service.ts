import { Command } from '@tauri-apps/plugin-shell'
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
 * Construye argumentos con flags recomendados para audio MP3 embebido.
 */
export function buildYtdlpAudioArgs(
  ffmpegDir: string,
  outputTemplate: string,
  videoUrl: string
): string[] {
  return [
    '--ffmpeg-location',
    ffmpegDir,
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
  videoUrl: string
): string[] {
  return [
    '--ffmpeg-location',
    ffmpegDir,
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
export async function spawnYtdlp(
  args: string[],
  callbacks: YtdlpSpawnCallbacks = {}
): Promise<YtdlpRunHandle> {
  const cmd = Command.sidecar(YTDLP_SIDECAR, args)

  const out = createLineSplitter((line) => callbacks.onStdoutLine?.(line))
  const err = createLineSplitter((line) => callbacks.onStderrLine?.(line))

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
      resolve({ code: payload.code, signal: payload.signal })
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
  cmd.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  cmd.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  const completion = new Promise<YtdlpExitInfo>((resolve, reject) => {
    cmd.once('error', (msg: string) => {
      reject(new Error(msg || 'shell spawn error'))
    })
    cmd.once('close', (payload: { code: number | null; signal: number | null }) => {
      resolve({ code: payload.code, signal: payload.signal })
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
