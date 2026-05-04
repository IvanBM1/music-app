import { writable } from 'svelte/store'
import { youtubeVideoId } from '../lib/youtube-url'

export const previewEmbedStore = writable<{ videoId: string | null }>({
  videoId: null
})

/** Muestra el reproductor embebido (iframe). Devuelve false si la URL no es un vídeo de YouTube. */
export function openYoutubeEmbedFromUrl(sourceUrl: string): boolean {
  const id = youtubeVideoId(sourceUrl.trim())
  if (!id) return false
  previewEmbedStore.set({ videoId: id })
  return true
}

export function closeYoutubeEmbed(): void {
  previewEmbedStore.set({ videoId: null })
}
