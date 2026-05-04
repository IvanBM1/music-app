import { open } from '@tauri-apps/plugin-shell'
import { youtubeSingleVideoUrl } from '../lib/youtube-url'
import { appendStructuredLog } from '../stores/downloads.store'

/**
 * Abre en el navegador la URL de origen del MP3 (p. ej. YouTube), para previsualizar antes de descargar.
 */
export async function previewDownloadSourceInBrowser(sourceUrl: string): Promise<void> {
  const u = youtubeSingleVideoUrl(sourceUrl.trim())
  if (!u) {
    appendStructuredLog('preview', 'No hay URL de origen para previsualizar.')
    return
  }
  try {
    await open(u)
  } catch (e) {
    appendStructuredLog('preview', e instanceof Error ? e.message : String(e))
  }
}
