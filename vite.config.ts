import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      // iconv-lite/internal.js usa `require('string_decoder')`; sin esto Rolldown lo
      // externaliza y en el webview queda undefined → pantalla en blanco.
      string_decoder: path.resolve(__dirname, 'node_modules/string_decoder/lib/string_decoder.js')
    }
  },
  optimizeDeps: {
    include: [
      'node-id3',
      'buffer',
      'iconv-lite',
      'iconv-lite/encodings/index.js',
      'string_decoder'
    ]
  }
})
