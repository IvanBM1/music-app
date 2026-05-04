import { downloadDir, join } from '@tauri-apps/api/path'
import { Command } from '@tauri-apps/plugin-shell'
import { exists, mkdir, readFile, remove } from '@tauri-apps/plugin-fs'
import { get, writable } from 'svelte/store'
import { youtubeSingleVideoUrl } from '../lib/youtube-url'
import { getDownloadsState } from '../stores/downloads.store'
import { closeYoutubeEmbed } from '../stores/preview-embed.store'
import { appendStructuredLog } from '../stores/downloads.store'
import { resolveBundledFfmpegDirectory } from './ffmpeg.service'
import { buildYtdlpPreviewAudioArgs, YTDLP_SIDECAR, ytDlpPreambleArgs } from './ytdlp.service'

export const previewPlaybackStore = writable({
  loading: false,
  error: null as string | null
})

let lastFilePath: string | null = null
let lastObjectUrl: string | null = null
let audio: HTMLAudioElement | null = null

async function ensurePreviewDir(): Promise<string> {
  const dir = await join(await downloadDir(), 'music-app', '.audio-preview')
  await mkdir(dir, { recursive: true })
  return dir
}

async function removeFileIfAny(): Promise<void> {
  if (!lastFilePath) return
  const p = lastFilePath
  lastFilePath = null
  try {
    await remove(p)
  } catch {
    /* ya borrado o inaccesible */
  }
}

function detachAudio(): void {
  if (!audio) return
  audio.onended = null
  audio.onerror = null
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if (lastObjectUrl) {
    URL.revokeObjectURL(lastObjectUrl)
    lastObjectUrl = null
  }
}

export async function stopLocalPreviewAudio(): Promise<void> {
  previewPlaybackStore.set({ loading: false, error: null })
  detachAudio()
  await removeFileIfAny()
}

/**
 * Descarga un MP3 temporal con yt-dlp y lo reproduce en el webview vía `blob:` (WKWebView
 * suele rechazar `<audio>` con URLs de `convertFileSrc` / `asset://`).
 * Borra el archivo anterior y al terminar la reproducción.
 */
export async function playYoutubePreviewLocal(sourceUrl: string): Promise<void> {
  const url = youtubeSingleVideoUrl(sourceUrl.trim())
  if (!url) {
    previewPlaybackStore.set({ loading: false, error: 'URL inválida para vista previa.' })
    return
  }

  if (get(previewPlaybackStore).loading) return

  closeYoutubeEmbed()
  await stopLocalPreviewAudio()
  previewPlaybackStore.set({ loading: true, error: null })

  try {
    const previewDir = await ensurePreviewDir()
    const base = await join(previewDir, `preview-${crypto.randomUUID()}`)
    const tpl = `${base}.%(ext)s`
    const ffmpegDir = await resolveBundledFfmpegDirectory()
    const preamble = await ytDlpPreambleArgs(getDownloadsState().ytdlpCookiesPath)
    const args = buildYtdlpPreviewAudioArgs(ffmpegDir, tpl, url, preamble)

    const result = await Command.sidecar(YTDLP_SIDECAR, args).execute()
    if (result.code !== 0) {
      const errText =
        typeof result.stderr === 'string' && result.stderr.trim()
          ? result.stderr.trim()
          : `yt-dlp salió con código ${result.code}`
      throw new Error(errText.slice(0, 800))
    }

    const outMp3 = `${base}.mp3`
    if (!(await exists(outMp3))) {
      throw new Error('No se generó el archivo de audio temporal.')
    }

    const bytes = await readFile(outMp3)
    lastFilePath = outMp3
    if (!audio) audio = new Audio()
    detachAudio()
    lastObjectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
    audio.src = lastObjectUrl
    audio.onended = () => {
      void removeFileIfAny()
      detachAudio()
      previewPlaybackStore.set({ loading: false, error: null })
    }
    audio.onerror = () => {
      void removeFileIfAny()
      detachAudio()
      previewPlaybackStore.set({
        loading: false,
        error: 'No se pudo reproducir el audio temporal.'
      })
    }
    await audio.play()
    previewPlaybackStore.set({ loading: false, error: null })
    appendStructuredLog('preview-audio', 'Reproduciendo vista previa local (temporal)')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    previewPlaybackStore.set({ loading: false, error: msg })
    appendStructuredLog('preview-audio', msg)
    detachAudio()
    await removeFileIfAny()
  }
}
