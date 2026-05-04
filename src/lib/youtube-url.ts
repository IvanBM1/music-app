/**
 * Normaliza URLs de YouTube a un solo vídeo (sin `list=`).
 * Equivale a `youtubeSingleVideoUrl` del script Node de referencia.
 */
export function youtubeSingleVideoUrl(url: string): string {
  const s = String(url ?? '').trim()
  if (!s) return ''
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^www\./, '')
    if ((host === 'youtube.com' || host === 'm.youtube.com') && u.pathname === '/watch') {
      const v = u.searchParams.get('v')
      if (v) return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`
    }
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0]
      if (id) return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
    }
  } catch {
    /* URL inválida */
  }
  return s
}

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/

/** Extrae el id de vídeo (11 caracteres) desde una URL de YouTube ya normalizada o bruta. */
export function youtubeVideoId(url: string): string {
  const s = String(url ?? '').trim()
  if (!s) return ''
  try {
    const normalized = youtubeSingleVideoUrl(s)
    const u = new URL(normalized || s)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v')
      if (v && YOUTUBE_ID_RE.test(v)) return v
    }
    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0]
      if (id && YOUTUBE_ID_RE.test(id)) return id
    }
  } catch {
    /* URL inválida */
  }
  return ''
}

/**
 * Origen que YouTube acepta en el parámetro `origin` del embed (mitiga error 153 en WKWebView / Tauri).
 */
function youtubeEmbedOriginParam(): string {
  if (typeof window === 'undefined') return 'https://www.youtube.com'
  const o = window.location?.origin ?? ''
  if (o.startsWith('https://')) return o
  // http://localhost (dev), tauri://, asset://, etc.
  return 'https://www.youtube.com'
}

/** URL del iframe del reproductor embebido (referrer + origin para compatibilidad con WebView). */
export function youtubeEmbedPlayerUrl(videoId: string): string {
  const id = encodeURIComponent(videoId)
  const p = new URLSearchParams({
    autoplay: '1',
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
    modestbranding: '1',
    origin: youtubeEmbedOriginParam()
  })
  return `https://www.youtube.com/embed/${id}?${p.toString()}`
}
