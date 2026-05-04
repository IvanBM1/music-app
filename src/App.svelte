<script lang="ts">
  import type { DownloadTask } from './lib/types/downloads.types'
  import { downloadsStore, removeDownloadTasksByDraftId } from './stores/downloads.store'
  import {
    clearDraftCoverImage,
    playlistDraftStore,
    removeDraftTrackById
  } from './stores/playlist-draft.store'
  import {
    clearYtdlpCookiesFile,
    pickYtdlpCookiesFile,
    requestCancelDownloads
  } from './services/downloads.service'
  import {
    downloadPlaylistFromDraft,
    loadYoutubePlaylistIntoDraft,
    pickDraftCoverImage
  } from './services/create-playlist.service'
  import { previewPlaybackStore, stopLocalPreviewAudio } from './services/preview-audio.service'
  import {
    closeYoutubeEmbed,
    openYoutubeEmbedFromUrl,
    previewEmbedStore
  } from './stores/preview-embed.store'
  import { youtubeEmbedPlayerUrl, youtubeVideoId } from './lib/youtube-url'
  import Button from './components/Button.svelte'
  import ListPlus from 'lucide-svelte/icons/list-plus'
  import Download from 'lucide-svelte/icons/download'
  import Square from 'lucide-svelte/icons/square'
  import MonitorPlay from 'lucide-svelte/icons/monitor-play'
  import Play from 'lucide-svelte/icons/play'
  import Trash2 from 'lucide-svelte/icons/trash-2'
  import X from 'lucide-svelte/icons/x'
  import ImageIcon from 'lucide-svelte/icons/image'
  import { isTauri } from '@tauri-apps/api/core'
  import { readFile } from '@tauri-apps/plugin-fs'

  /** `blob:` URL para la miniatura; `convertFileSrc` puede no ser válido en el webview sin asset protocol. */
  let coverPreviewObjectUrl = $state<string | null>(null)

  function coverMimeFromPath(filePath: string): string {
    const lower = filePath.toLowerCase()
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    return 'application/octet-stream'
  }

  $effect(() => {
    const path = $playlistDraftStore.coverImagePath?.trim() ?? ''

    if (!path || !isTauri()) {
      if (coverPreviewObjectUrl) {
        URL.revokeObjectURL(coverPreviewObjectUrl)
        coverPreviewObjectUrl = null
      }
      return () => {}
    }

    let cancelled = false
    let created: string | null = null

    void readFile(path)
      .then((bytes) => {
        if (cancelled) return
        if (coverPreviewObjectUrl) URL.revokeObjectURL(coverPreviewObjectUrl)
        created = URL.createObjectURL(new Blob([bytes], { type: coverMimeFromPath(path) }))
        coverPreviewObjectUrl = created
      })
      .catch(() => {
        /* Sin vista previa si falta permiso o el archivo no es legible */
      })

    return () => {
      cancelled = true
      if (created) {
        URL.revokeObjectURL(created)
        if (coverPreviewObjectUrl === created) coverPreviewObjectUrl = null
      }
    }
  })

  function cancelQueue() {
    void requestCancelDownloads()
  }

  function taskForDraft(tasks: DownloadTask[], draftId: string): DownloadTask | undefined {
    return tasks.find((t) => t.draftId === draftId)
  }

  function removeDraftRow(draftId: string) {
    removeDownloadTasksByDraftId(draftId)
    removeDraftTrackById(draftId)
  }

  function runDownloads() {
    void downloadPlaylistFromDraft()
  }

  function updateDraftUrl(ev: Event) {
    const v = (ev.currentTarget as HTMLInputElement).value
    playlistDraftStore.update((s) => ({ ...s, sourceUrl: v }))
  }

  function updatePlaylistName(ev: Event) {
    const v = (ev.currentTarget as HTMLInputElement).value
    playlistDraftStore.update((s) => ({ ...s, playlistName: v }))
  }

  function coverBasename(path: string | null): string {
    if (!path?.trim()) return ''
    const parts = path.replace(/\\/g, '/').split('/')
    return parts.pop() ?? path
  }

  function cookiesPathLabel(path: string | null): string {
    if (!path?.trim()) return 'Ninguna — sin cookies de navegador'
    return coverBasename(path)
  }

  async function pickYtdlpCookies() {
    await pickYtdlpCookiesFile()
  }

  async function clearYtdlpCookies() {
    await clearYtdlpCookiesFile()
  }

  function fetchYoutubeList() {
    void loadYoutubePlaylistIntoDraft()
  }

  function playEmbedInApp(url: string) {
    void stopLocalPreviewAudio()
    openYoutubeEmbedFromUrl(url)
  }

  function queueCount(tracks: number): string {
    if (tracks === 1) return '1 elemento'
    return `${tracks} elementos`
  }

  function statusLine(task: DownloadTask | undefined): { text: string; tone: 'muted' | 'active' | 'ok' | 'err' } {
    if (!task) return { text: 'En cola', tone: 'muted' }
    switch (task.status) {
      case 'queued':
        return { text: 'En cola', tone: 'muted' }
      case 'running': {
        const p = task.progress?.percent
        const pct = p != null ? ` • ${Math.round(p)}%` : ''
        return { text: `Descargando${pct}`, tone: 'active' }
      }
      case 'completed':
        return { text: 'Completado', tone: 'ok' }
      case 'failed':
        return { text: task.error?.trim() ? `Error: ${task.error}` : 'Error', tone: 'err' }
      case 'cancelled':
        return { text: 'Cancelado', tone: 'err' }
      default:
        return { text: task.status, tone: 'muted' }
    }
  }

  function barFillClass(status: DownloadTask['status']): string {
    if (status === 'completed') return 'is-done'
    if (status === 'failed' || status === 'cancelled') return 'is-err'
    return 'is-active'
  }

  /** Progreso del lote: cada pista pesa 1/n; la activa suma su % de yt-dlp. */
  const globalDownload = $derived.by(() => {
    const { tasks, isProcessing, activeTaskId } = $downloadsStore
    if (!isProcessing || tasks.length === 0) {
      return {
        show: false as const,
        percent: 0,
        indexLine: '',
        title: '',
        speedEta: ''
      }
    }
    const n = tasks.length
    let acc = 0
    for (const t of tasks) {
      if (t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') {
        acc += 1
      } else if (t.status === 'running') {
        const p = t.progress?.percent
        acc += p != null ? Math.min(100, Math.max(0, p)) / 100 : 0
      }
    }
    const percent = n > 0 ? (acc / n) * 100 : 0
    const terminal = tasks.filter(
      (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
    ).length
    const running =
      tasks.find((t) => t.id === activeTaskId && t.status === 'running') ??
      tasks.find((t) => t.status === 'running')
    const pos = running ? terminal + 1 : Math.min(terminal + 1, n)
    const finWord = terminal === 1 ? 'finalizada' : 'finalizadas'
    const indexLine = `Pista ${pos} de ${n} · ${terminal} ${finWord}`
    const title = running?.title?.trim() ? running.title : 'Siguiente pista…'
    const sp = running?.progress?.speed
    const eta = running?.progress?.eta
    const bits = [sp, eta ? `ETA ${eta}` : ''].filter(Boolean)
    const speedEta = bits.join(' · ')
    return { show: true as const, percent, indexLine, title, speedEta }
  })
</script>

<header class="topbar">
  <span class="topbar-title">Descarga música</span>
</header>

{#if globalDownload.show}
  <section
    class="global-dl"
    aria-label="Progreso total de descargas"
    role="status"
    aria-live="polite"
  >
    <div class="global-dl-inner">
      <div class="global-dl-head">
        <span class="global-dl-label">Descarga en curso</span>
        <span class="global-dl-pct">{Math.round(globalDownload.percent)}%</span>
      </div>
      <p class="global-dl-title">{globalDownload.title}</p>
      <p class="global-dl-meta">
        {globalDownload.indexLine}
        {#if globalDownload.speedEta}
          <span class="global-dl-sep">·</span>
          {globalDownload.speedEta}
        {/if}
      </p>
      <div
        class="global-dl-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(globalDownload.percent)}
        aria-valuetext={`${Math.round(globalDownload.percent)} por ciento del lote`}
      >
        <div class="global-dl-fill" style:width="{globalDownload.percent}%"></div>
      </div>
    </div>
  </section>
{/if}

<main class="shell">
  <div class="shell-card">
    <div class="layout">
      <aside class="col-form" aria-labelledby="brand-heading">
        <div class="brand">
          <h1 id="brand-heading" class="brand-name">Music Downloader</h1>
          <p class="brand-tag">Importa playlists desde YouTube</p>
        </div>

        <div class="stack-fields">
          <label class="field">
            <span class="field-label">URL de YouTube</span>
            <input
              type="url"
              class="field-input"
              placeholder="Pega la URL del video o lista…"
              value={$playlistDraftStore.sourceUrl}
              oninput={updateDraftUrl}
              disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
              autocomplete="off"
            />
          </label>

          {#if isTauri()}
            <div class="field">
              <span class="field-label">Cookies de YouTube (opcional)</span>
              <p class="field-hint">
                Si aparece el aviso de «bot» o inicio de sesión, exporta cookies en formato Netscape y elige el
                archivo. Guía:
                <a
                  class="field-hint-link"
                  href="https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
                  target="_blank"
                  rel="noopener noreferrer">yt-dlp — cookies</a
                >. Los retos JavaScript de YouTube requieren
                <a
                  class="field-hint-link"
                  href="https://github.com/yt-dlp/yt-dlp/wiki/EJS"
                  target="_blank"
                  rel="noopener noreferrer">Deno (EJS)</a
                >: la app lo empaqueta si ejecutas <code class="field-hint-code">npm run fetch-sidecars</code> antes del
                build (o usas el workflow de CI).
              </p>
              <div class="cookies-row">
                <span
                  class="cookies-path"
                  title={$downloadsStore.ytdlpCookiesPath ?? ''}
                >{cookiesPathLabel($downloadsStore.ytdlpCookiesPath)}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onclick={() => void pickYtdlpCookies()}
                  disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
                >
                  Elegir archivo…
                </Button>
                {#if $downloadsStore.ytdlpCookiesPath}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onclick={() => void clearYtdlpCookies()}
                    disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
                  >
                    Quitar
                  </Button>
                {/if}
              </div>
            </div>
          {/if}

          <Button
            variant="outline"
            class="action-full"
            icon={ListPlus}
            onclick={fetchYoutubeList}
            disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
          >
            {$playlistDraftStore.loading ? 'Listando…' : 'Cargar lista'}
          </Button>

          {#if $playlistDraftStore.tracks.length > 0}
            <label class="field">
              <span class="field-label">Nombre de la playlist</span>
              <input
                type="text"
                class="field-input"
                placeholder="Mi playlist"
                value={$playlistDraftStore.playlistName}
                oninput={updatePlaylistName}
                disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
                autocomplete="off"
              />
            </label>

            <div class="field">
              <span class="field-label">Portada (Cover Art)</span>
              <div class="cover-drop">
                {#if $playlistDraftStore.coverImagePath}
                  <div class="cover-preview">
                    {#key $playlistDraftStore.coverImagePath}
                      {#if coverPreviewObjectUrl}
                        <img
                          src={coverPreviewObjectUrl}
                          alt="Vista previa de la portada"
                          class="cover-preview-img"
                        />
                      {:else}
                        <div class="cover-preview-fallback">
                          <ImageIcon size={28} strokeWidth={1.5} class="cover-drop-icon" />
                          <span class="cover-preview-fallback-name"
                            >{coverBasename($playlistDraftStore.coverImagePath)}</span
                          >
                          <span class="cover-preview-fallback-hint"
                            >{isTauri()
                              ? 'No se pudo cargar la imagen (permisos o archivo).'
                              : 'La vista previa solo está disponible en la app.'}</span
                          >
                        </div>
                      {/if}
                    {/key}
                    <div class="cover-preview-actions">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onclick={() => void pickDraftCoverImage()}
                        disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
                      >
                        Cambiar imagen
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        class="queue-trash"
                        icon={Trash2}
                        title="Quitar portada"
                        aria-label="Eliminar portada"
                        onclick={() => clearDraftCoverImage()}
                        disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
                      />
                    </div>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="cover-drop-btn"
                    onclick={() => void pickDraftCoverImage()}
                    disabled={$playlistDraftStore.loading || $downloadsStore.isProcessing}
                  >
                    <ImageIcon size={22} strokeWidth={1.5} class="cover-drop-icon" />
                    <span class="cover-drop-title">Seleccionar imagen</span>
                    <span class="cover-drop-hint">PNG o JPG</span>
                  </button>
                {/if}
              </div>
            </div>

            <div class="actions-stack">
              <Button
                variant="default"
                class="action-full"
                icon={Download}
                onclick={() => runDownloads()}
                disabled={$playlistDraftStore.loading ||
                  $downloadsStore.isProcessing ||
                  $playlistDraftStore.tracks.length === 0 ||
                  !$playlistDraftStore.playlistName?.trim()}
              >
                Iniciar descarga
              </Button>
              <Button
                variant="outline"
                class="action-full action-stop"
                icon={Square}
                onclick={cancelQueue}
                disabled={!$downloadsStore.isProcessing}
              >
                Detener descarga
              </Button>
            </div>
          {/if}
        </div>


        {#if $playlistDraftStore.error}
          <p class="banner-err">{$playlistDraftStore.error}</p>
        {/if}
      </aside>

      <div class="col-main">
        <section class="preview-block" aria-labelledby="preview-label">
          <p id="preview-label" class="section-kicker">Vista previa</p>
          <div class="preview-frame">
            {#if $previewEmbedStore.videoId}
              <div class="preview-toolbar">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="preview-close"
                  icon={X}
                  iconPosition="end"
                  onclick={() => closeYoutubeEmbed()}
                >
                  Cerrar
                </Button>
              </div>
              {#key $previewEmbedStore.videoId}
                <div class="preview-ratio">
                  <iframe
                    src={youtubeEmbedPlayerUrl($previewEmbedStore.videoId)}
                    title="Vista previa de YouTube"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                    allowfullscreen
                    referrerpolicy="strict-origin-when-cross-origin"
                  ></iframe>
                </div>
              {/key}
            {:else}
              <div class="preview-placeholder">
                <MonitorPlay size={40} strokeWidth={1.25} class="preview-ph-icon" />
                <p class="preview-ph-title">Reproduce un elemento de la lista</p>
                <p class="preview-ph-sub">La vista previa del video aparecerá aquí</p>
              </div>
            {/if}
          </div>
          {#if $previewPlaybackStore.loading}
            <p class="preview-foot">Descargando extracto de audio (~90 s)…</p>
          {/if}
          {#if $previewPlaybackStore.error}
            <p class="preview-foot preview-foot-err">{$previewPlaybackStore.error}</p>
          {/if}
        </section>

        <section class="queue-block" aria-labelledby="queue-heading">
          <div class="queue-head">
            <h2 id="queue-heading" class="queue-title">Cola de descarga</h2>
            <span class="queue-count">{queueCount($playlistDraftStore.tracks.length)}</span>
          </div>

          {#if $playlistDraftStore.tracks.length === 0}
            <p class="queue-empty">Carga una lista para ver las pistas aquí.</p>
          {:else}
            <ul class="queue-list">
              {#each $playlistDraftStore.tracks as row, index (row.draftId)}
                {@const task = taskForDraft($downloadsStore.tasks, row.draftId)}
                {@const line = statusLine(task)}
                {@const pct = task?.progress?.percent}
                {@const rowVideoId = youtubeVideoId(row.videoUrl || '')}
                {@const isPreviewingThis =
                  Boolean($previewEmbedStore.videoId && rowVideoId === $previewEmbedStore.videoId)}
                <li class="queue-card">
                  <div class="queue-body">
                    <p class="queue-track-title">{index + 1}. {row.artist} — {row.title}</p>
                    <div class="queue-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct ?? undefined}>
                      <div
                        class="queue-bar-fill {barFillClass(task?.status ?? 'queued')}"
                        style:width="{task?.status === 'completed'
                          ? 100
                          : pct != null
                            ? pct
                            : task?.status === 'failed' || task?.status === 'cancelled'
                              ? 100
                              : 0}%"
                      ></div>
                    </div>
                    <p class="queue-status" data-tone={line.tone}>{line.text}</p>
                    {#if task?.error && task.status !== 'failed'}
                      <p class="queue-task-err">{task.error}</p>
                    {/if}
                  </div>
                  <div class="queue-side-actions">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      class={isPreviewingThis ? 'queue-play queue-play--active' : 'queue-play'}
                      icon={Play}
                      title="Ver vídeo aquí (YouTube)"
                      aria-label="Reproducir vista previa"
                      aria-pressed={isPreviewingThis}
                      onclick={() => playEmbedInApp(row.videoUrl)}
                      disabled={!rowVideoId || $playlistDraftStore.loading || $downloadsStore.isProcessing}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      class="queue-trash"
                      icon={Trash2}
                      title="Quitar de la lista"
                      aria-label="Quitar de la lista"
                      onclick={() => removeDraftRow(row.draftId)}
                      disabled={$playlistDraftStore.loading || task?.status === 'running'}
                    />
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    </div>
  </div>

  <details class="log-details">
    <summary>Log</summary>
    <pre class="log">{$downloadsStore.logLines.slice(-400).join('\n')}</pre>
  </details>
</main>

<style>
  :global(body) {
    background: #f9fafb;
  }

  .topbar {
    background: #111827;
    color: #fff;
    padding: 0.5rem 1.25rem;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .topbar-title {
    letter-spacing: 0.01em;
  }

  .global-dl {
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
    border-bottom: 1px solid #e2e8f0;
  }

  .global-dl-inner {
    max-width: 72rem;
    margin: 0 auto;
    padding: 0.65rem 1.25rem 0.75rem;
    box-sizing: border-box;
  }

  .global-dl-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .global-dl-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
  }

  .global-dl-pct {
    font-size: 0.875rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #0f172a;
  }

  .global-dl-title {
    margin: 0.2rem 0 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: #111827;
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .global-dl-meta {
    margin: 0.15rem 0 0.45rem;
    font-size: 0.75rem;
    color: #64748b;
    line-height: 1.4;
  }

  .global-dl-sep {
    margin: 0 0.2rem;
    opacity: 0.7;
  }

  .global-dl-track {
    height: 8px;
    border-radius: 999px;
    background: #e2e8f0;
    overflow: hidden;
  }

  .global-dl-fill {
    height: 100%;
    min-width: 0;
    border-radius: 999px;
    background: #111827;
    transition: width 0.2s ease-out;
  }

  .shell {
    padding: 1.25rem;
    max-width: 72rem;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .shell-card {
    background: #fff;
    border-radius: 1rem;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.06);
    border: 1px solid #e5e7eb;
    padding: 1.5rem 1.75rem;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    gap: 1.75rem 2rem;
    align-items: start;
  }

  @media (max-width: 960px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .col-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }

  .brand {
    margin: 0;
  }

  .brand-name {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: #111827;
    letter-spacing: -0.02em;
  }

  .brand-tag {
    margin: 0.35rem 0 0;
    font-size: 0.875rem;
    color: #6b7280;
  }

  .stack-fields {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .field-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #374151;
  }

  .field-input {
    width: 100%;
    box-sizing: border-box;
    height: 2.5rem;
    border-radius: 0.75rem;
    border: 1px solid #e5e7eb;
    background: #fff;
    padding: 0 0.875rem;
    font-size: 0.875rem;
    font-family: inherit;
    color: #111827;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .field-input::placeholder {
    color: #9ca3af;
  }

  .field-input:focus-visible {
    outline: 2px solid #111827;
    outline-offset: 2px;
    border-color: #d1d5db;
  }

  .field-input:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .field-hint {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: #6b7280;
  }

  .field-hint-link {
    color: #2563eb;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .field-hint-link:hover {
    color: #1d4ed8;
  }

  .field-hint-code {
    font-size: 0.72rem;
    font-family: ui-monospace, monospace;
    background: #f3f4f6;
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
  }

  .cookies-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
  }

  .cookies-path {
    flex: 1 1 8rem;
    min-width: 0;
    font-size: 0.75rem;
    color: #4b5563;
    word-break: break-all;
  }

  .cover-drop {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .cover-drop-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    min-height: 7.5rem;
    width: 100%;
    border-radius: 0.75rem;
    border: 2px dashed #d1d5db;
    background: #f9fafb;
    cursor: pointer;
    font-family: inherit;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .cover-drop-btn:hover:not(:disabled) {
    background: #f3f4f6;
    border-color: #9ca3af;
  }

  .cover-drop-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  :global(.cover-drop-icon) {
    color: #9ca3af;
  }

  .cover-drop-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: #374151;
  }

  .cover-drop-hint {
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .cover-preview {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    border-radius: 0.75rem;
    border: 1px solid #e5e7eb;
    background: #fafafa;
    padding: 0.65rem;
    box-sizing: border-box;
  }

  .cover-preview-img {
    display: block;
    width: 100%;
    max-height: 11rem;
    object-fit: contain;
    border-radius: 0.5rem;
    background: #fff;
  }

  .cover-preview-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 6.5rem;
    padding: 0.75rem;
    text-align: center;
    border-radius: 0.5rem;
    background: #fff;
    border: 1px dashed #e5e7eb;
  }

  .cover-preview-fallback-name {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #374151;
    word-break: break-all;
    max-width: 100%;
  }

  .cover-preview-fallback-hint {
    font-size: 0.72rem;
    color: #9ca3af;
  }

  .cover-preview-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .cover-preview-actions :global(.shadcn-btn:not(.queue-trash)) {
    flex: 1;
    min-width: 8rem;
    justify-content: center;
    border-radius: 0.625rem;
  }

  .actions-stack {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  :global(.action-full) {
    width: 100%;
    justify-content: center;
    border-radius: 0.75rem !important;
    height: 2.5rem !important;
  }

  :global(.action-stop.shadcn-btn) {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
  }

  :global(.action-stop.shadcn-btn:hover:not(:disabled)) {
    background: #fee2e2;
    border-color: #fca5a5;
  }

  .banner-err {
    margin: 0;
    font-size: 0.8125rem;
    color: #b91c1c;
  }

  .col-main {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
  }

  .section-kicker {
    margin: 0 0 0.5rem;
    font-size: 0.8125rem;
    color: #6b7280;
    font-weight: 500;
  }

  .preview-block {
    min-width: 0;
  }

  .preview-frame {
    position: relative;
    background: #111827;
    border-radius: 0.75rem;
    overflow: hidden;
    min-height: 12rem;
  }

  .preview-toolbar {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 2;
  }

  :global(.preview-close) {
    background: rgb(17 24 39 / 0.65) !important;
    color: #fff !important;
    border-color: transparent !important;
  }

  :global(.preview-close:hover:not(:disabled)) {
    background: rgb(17 24 39 / 0.85) !important;
  }

  :global(.preview-close .shadcn-btn__icon) {
    color: #fff;
  }

  .preview-ratio {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-height: min(42vh, 20rem);
    background: #0b1220;
  }

  .preview-ratio iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }

  .preview-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 2rem 1.25rem;
    min-height: 12rem;
    box-sizing: border-box;
  }

  :global(.preview-ph-icon) {
    color: #9ca3af;
    margin-bottom: 0.75rem;
  }

  .preview-ph-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    color: #f9fafb;
  }

  .preview-ph-sub {
    margin: 0.35rem 0 0;
    font-size: 0.8125rem;
    color: #9ca3af;
  }

  .preview-foot {
    margin: 0.5rem 0 0;
    font-size: 0.78rem;
    color: #6b7280;
  }

  .preview-foot-err {
    color: #b91c1c;
  }

  .queue-block {
    min-width: 0;
  }

  .queue-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.65rem;
  }

  .queue-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: #111827;
  }

  .queue-count {
    font-size: 0.8125rem;
    color: #6b7280;
    white-space: nowrap;
  }

  .queue-empty {
    margin: 0;
    padding: 1rem;
    font-size: 0.875rem;
    color: #9ca3af;
    text-align: center;
    border: 1px dashed #e5e7eb;
    border-radius: 0.75rem;
    background: #fafafa;
  }

  .queue-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    max-height: min(50vh, 22rem);
    overflow: auto;
  }

  .queue-card {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 0.75rem;
    background: #fafafa;
  }

  .queue-thumb {
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    border-radius: 0.5rem;
    background: #e5e7eb;
  }

  .queue-body {
    flex: 1;
    min-width: 0;
  }

  .queue-track-title {
    margin: 0 0 0.4rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: #111827;
    line-height: 1.35;
  }

  .queue-bar {
    height: 6px;
    border-radius: 999px;
    background: #e5e7eb;
    overflow: hidden;
  }

  .queue-bar-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.15s ease-out;
  }

  .queue-bar-fill.is-active {
    background: #111827;
  }

  .queue-bar-fill.is-done {
    background: #059669;
  }

  .queue-bar-fill.is-err {
    background: #dc2626;
  }

  .queue-status {
    margin: 0.35rem 0 0;
    font-size: 0.75rem;
    color: #6b7280;
  }

  .queue-status[data-tone='active'] {
    color: #111827;
  }

  .queue-status[data-tone='ok'] {
    color: #059669;
    font-weight: 500;
  }

  .queue-status[data-tone='err'] {
    color: #b91c1c;
  }

  .queue-task-err {
    margin: 0.25rem 0 0;
    font-size: 0.72rem;
    color: #b91c1c;
  }

  .queue-raw {
    margin: 0.25rem 0 0;
    font-size: 0.68rem;
    color: #9ca3af;
  }

  .queue-side-actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.35rem;
    flex-shrink: 0;
  }

  :global(.queue-play--active.shadcn-btn) {
    background: #111827;
    border-color: #111827;
    color: #f9fafb;
  }

  :global(.queue-play--active.shadcn-btn:hover:not(:disabled)) {
    background: #1f2937;
    border-color: #1f2937;
    color: #f9fafb;
  }

  :global(.queue-play--active .shadcn-btn__icon) {
    color: #f9fafb;
  }

  :global(.queue-trash.shadcn-btn) {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
  }

  :global(.queue-trash.shadcn-btn:hover:not(:disabled)) {
    background: #fee2e2;
  }

  :global(.queue-trash .shadcn-btn__icon) {
    color: #b91c1c;
  }

  .log-details {
    margin-top: 1rem;
    font-size: 0.8125rem;
    color: #4b5563;
  }

  .log-details summary {
    cursor: pointer;
    user-select: none;
    font-weight: 500;
  }

  pre.log {
    margin: 0.5rem 0 0;
    padding: 0.65rem;
    background: #1a1a1a;
    color: #ddd;
    border-radius: 0.5rem;
    font-size: 0.68rem;
    max-height: 12rem;
    overflow: auto;
    white-space: pre-wrap;
  }
</style>
