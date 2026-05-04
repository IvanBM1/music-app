/**
 * En el webview, iconv-lite a veces no carga el mapa `encodings/` vía require perezoso;
 * node-id3 usa `UTF-16` en marcos ID3 → "Encoding not recognized: 'UTF-16' (searched as: 'utf16')".
 */
import iconv from 'iconv-lite'
// @ts-expect-error — iconv-lite no publica tipos para `encodings/index.js`
import * as encodingsStar from 'iconv-lite/encodings/index.js'

const encodings =
  encodingsStar &&
  typeof (encodingsStar as { default?: Record<string, unknown> }).default === 'object' &&
  (encodingsStar as { default: Record<string, unknown> }).default
    ? (encodingsStar as { default: Record<string, unknown> }).default
    : (encodingsStar as unknown as Record<string, unknown>)

const ic = iconv as typeof iconv & { encodings?: Record<string, unknown> | null }
if (!ic.encodings?.utf16) {
  ic.encodings = encodings
}
