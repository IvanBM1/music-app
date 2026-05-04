import { join, resourceDir } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'
import { arch, exeExtension, platform, type as osKind } from '@tauri-apps/plugin-os'

/** Sufijo `deno-<triple>` / `ffmpeg-<triple>` alineado con `rustc` / releases oficiales. */
export function sidecarHostTripleSuffix(): string {
  const os = osKind()
  const a = arch()
  if (os === 'macos' || os === 'ios') {
    if (a === 'aarch64' || a === 'arm') return 'aarch64-apple-darwin'
    return 'x86_64-apple-darwin'
  }
  if (os === 'windows') {
    return a === 'aarch64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  }
  if (os === 'linux') {
    return a === 'aarch64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'
  }
  return 'x86_64-unknown-linux-gnu'
}

/**
 * Ruta absoluta al binario Deno empaquetado (para retos JS / EJS de YouTube en yt-dlp).
 * Devuelve `null` si no existe (p. ej. no se ejecutó `npm run fetch-sidecars`).
 */
export async function resolveBundledDenoForYtdlp(): Promise<string | null> {
  const dir = await resolveBundledFfmpegDirectory()
  const triple = sidecarHostTripleSuffix()
  const ext = exeExtension()
  const base = `deno-${triple}`
  const fileName = ext ? `${base}.${ext}` : base
  const full = await join(dir, fileName)
  try {
    if (await exists(full)) return full
  } catch {
    return null
  }
  return null
}

/**
 * Resuelve el directorio donde están los sidecars `ffmpeg` y `ffprobe`
 * (Tauri copia `externalBin` junto al ejecutable o en layout `target/debug`).
 *
 * Usa `platform()` del plugin OS (sin `navigator.userAgent`).
 */
export async function resolveBundledFfmpegDirectory(): Promise<string> {
  const res = await resourceDir()
  const plat = platform()

  if (plat === 'windows') {
    return res
  }

  if (plat === 'macos' || plat === 'ios') {
    if (res.includes('.app/Contents/Resources')) {
      return join(res, '..', 'MacOS')
    }
    return res
  }

  /* Linux / BSD: en `tauri dev` a veces `…/target/debug/lib/<crate>`. */
  if (/\/target\/(debug|release)\/lib\//.test(res)) {
    return join(res, '..', '..')
  }

  return res
}
