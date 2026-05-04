import { join, resourceDir } from '@tauri-apps/api/path'
import { platform } from '@tauri-apps/plugin-os'

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
