import { Store } from '@tauri-apps/plugin-store'
import { setYtdlpCookiesPath } from '../stores/downloads.store'

const STORE_PATH = 'downloads-prefs.json'
const KEY_YTDLP_COOKIES = 'ytdlpCookiesPath'

/** Carga preferencias guardadas (p. ej. ruta de cookies yt-dlp). */
export async function loadDownloadsPreferences(): Promise<void> {
  try {
    const store = await Store.load(STORE_PATH)
    const v = await store.get<string>(KEY_YTDLP_COOKIES)
    if (typeof v === 'string' && v.trim()) setYtdlpCookiesPath(v.trim())
  } catch {
    /* Entorno sin Tauri / store no disponible */
  }
}

/** Persiste la ruta del archivo Netscape de cookies para YouTube (`null` = borrar). */
export async function persistYtdlpCookiesPath(path: string | null): Promise<void> {
  setYtdlpCookiesPath(path)
  try {
    const store = await Store.load(STORE_PATH)
    if (path?.trim()) await store.set(KEY_YTDLP_COOKIES, path.trim())
    else await store.delete(KEY_YTDLP_COOKIES)
    await store.save()
  } catch {
    /* Sin store en web */
  }
}
