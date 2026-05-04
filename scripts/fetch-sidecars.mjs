#!/usr/bin/env node
/**
 * Descarga ffmpeg, ffprobe, yt-dlp y Deno (runtime EJS para YouTube) con los nombres que espera Tauri 2 (`externalBin`).
 * Usa el triple de `rustc -vV` (coincide con el sufijo del host de build en CI).
 *
 * Uso:
 *   node scripts/fetch-sidecars.mjs
 *   node scripts/fetch-sidecars.mjs --verify-bundle   # tras `npm run tauri build`
 *
 * En el bundle final Tauri suele publicar los binarios como `ffmpeg`, `ffprobe`, `yt-dlp`
 * (no como `ffmpeg-<triple>`); la verificación acepta ambas formas.
 * En Windows los sidecars suelen quedar en `target/release/*.exe` junto al exe principal;
 * el árbol `bundle/` contiene sobre todo el instalador, sin esos binarios sueltos.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const binDir = path.join(root, 'src-tauri', 'bin')

function rustcTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  const m = /^host:\s*(.+)$/m.exec(out)
  if (!m) throw new Error('No se pudo leer `host:` de rustc -vV')
  return m[1].trim()
}

async function fetchToFile(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  await fsp.writeFile(dest, buf)
}

/** PowerShell comilla simple: duplicar comillas internas. */
function pwshLiteralSingleQuoted(fsPath) {
  return `'${String(fsPath).replace(/'/g, "''")}'`
}

/**
 * Descomprime .zip. En Windows el `tar` integrado suele fallar (exit 128) con ZIPs grandes tipo BtbN;
 * usamos Expand-Archive. En macOS/Linux usamos tar.
 */
function extractZip(zipPath, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  if (process.platform === 'win32') {
    const zip = path.resolve(zipPath)
    const dest = path.resolve(outDir)
    const cmd = `Expand-Archive -LiteralPath ${pwshLiteralSingleQuoted(zip)} -DestinationPath ${pwshLiteralSingleQuoted(dest)} -Force`
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 }
    )
  } else {
    execFileSync('tar', ['-xf', zipPath, '-C', outDir], { stdio: 'inherit' })
  }
}

function findFileRecursive(rootDir, filename) {
  const stack = [rootDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) stack.push(p)
      else if (ent.name === filename) return p
    }
  }
  throw new Error(`No se encontró ${filename} bajo ${rootDir}`)
}

async function chmod755(p) {
  if (process.platform === 'win32') return
  await fsp.chmod(p, 0o755)
}

const GH_JSON_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'music-app-fetch-sidecars/1'
}

async function denoZipDownloadUrl(assetName) {
  const res = await fetch('https://api.github.com/repos/denoland/deno/releases/latest', {
    headers: GH_JSON_HEADERS
  })
  if (!res.ok) throw new Error(`GitHub API (deno): HTTP ${res.status}`)
  const data = await res.json()
  const asset = data.assets?.find((a) => a.name === assetName)
  if (!asset?.browser_download_url) {
    throw new Error(`No hay asset «${assetName}» en la última release de Deno`)
  }
  return asset.browser_download_url
}

/** Deno ≥2: yt-dlp lo usa para retos JavaScript (EJS) de YouTube. */
async function fetchDenoForTriple(triple) {
  const assetName = `deno-${triple}.zip`
  const url = await denoZipDownloadUrl(assetName)
  const tmpRoot = path.join(root, 'node_modules', '.sidecars-tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const zipPath = path.join(tmpRoot, `deno-${triple}.zip`)
  await fetchToFile(url, zipPath)
  const extractDir = path.join(tmpRoot, `deno-extract-${triple}`)
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  extractZip(zipPath, extractDir)
  const inner = triple.includes('windows') ? 'deno.exe' : 'deno'
  const found = findFileRecursive(extractDir, inner)
  await fsp.mkdir(binDir, { recursive: true })
  const destName = triple.includes('windows') ? `deno-${triple}.exe` : `deno-${triple}`
  const dest = path.join(binDir, destName)
  await fsp.copyFile(found, dest)
  await chmod755(dest)
  console.log(`Deno listo: ${destName}`)
}

async function fetchWindows(triple) {
  const tmpRoot = path.join(root, 'node_modules', '.sidecars-tmp')
  fs.mkdirSync(tmpRoot, { recursive: true })
  const zipPath = path.join(tmpRoot, 'ffmpeg-win.zip')
  const isArm = triple.startsWith('aarch64')
  const ffmpegUrl = isArm
    ? 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-winarm64-gpl.zip'
    : 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

  await fetchToFile(ffmpegUrl, zipPath)
  const extractDir = path.join(tmpRoot, 'ffmpeg-extracted')
  fs.rmSync(extractDir, { recursive: true, force: true })
  fs.mkdirSync(extractDir, { recursive: true })
  extractZip(zipPath, extractDir)

  const ffmpegPath = findFileRecursive(extractDir, 'ffmpeg.exe')
  const ffprobePath = findFileRecursive(extractDir, 'ffprobe.exe')
  await fsp.mkdir(binDir, { recursive: true })
  await fsp.copyFile(ffmpegPath, path.join(binDir, `ffmpeg-${triple}.exe`))
  await fsp.copyFile(ffprobePath, path.join(binDir, `ffprobe-${triple}.exe`))
  await fetchToFile(
    'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    path.join(binDir, `yt-dlp-${triple}.exe`)
  )
  await fetchDenoForTriple(triple)
  console.log(`Sidecars Windows listos (${triple}) en ${binDir}`)
}

async function fetchMacos(triple) {
  const tmp = fs.mkdtempSync(path.join(root, 'node_modules', '.sc-'))
  try {
    const ffZip = path.join(tmp, 'ffmpeg.zip')
    const fpZip = path.join(tmp, 'ffprobe.zip')
    await fetchToFile('https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip', ffZip)
    await fetchToFile('https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip', fpZip)
    const ffOut = path.join(tmp, 'ff')
    const fpOut = path.join(tmp, 'fp')
    fs.mkdirSync(ffOut, { recursive: true })
    fs.mkdirSync(fpOut, { recursive: true })
    extractZip(ffZip, ffOut)
    extractZip(fpZip, fpOut)

    const ffmpegBin = path.join(ffOut, 'ffmpeg')
    const ffprobeBin = path.join(fpOut, 'ffprobe')
    if (!fs.existsSync(ffmpegBin)) throw new Error('evermeet: zip sin binario `ffmpeg` en la raíz')
    if (!fs.existsSync(ffprobeBin)) throw new Error('evermeet: zip sin binario `ffprobe` en la raíz')

    await fsp.mkdir(binDir, { recursive: true })
    await fsp.copyFile(ffmpegBin, path.join(binDir, `ffmpeg-${triple}`))
    await fsp.copyFile(ffprobeBin, path.join(binDir, `ffprobe-${triple}`))
    await chmod755(path.join(binDir, `ffmpeg-${triple}`))
    await chmod755(path.join(binDir, `ffprobe-${triple}`))

    await fetchToFile(
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos',
      path.join(binDir, `yt-dlp-${triple}`)
    )
    await chmod755(path.join(binDir, `yt-dlp-${triple}`))
    await fetchDenoForTriple(triple)
    console.log(`Sidecars macOS listos (${triple}) en ${binDir}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function walkFiles(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walkFiles(p, acc)
    else acc.push(p)
  }
  return acc
}

function resolveCargoReleaseSubdir(sub) {
  const candidates = []
  const cargoTarget = process.env.CARGO_TARGET_DIR
  if (cargoTarget) candidates.push(path.join(cargoTarget, 'release', sub))
  candidates.push(path.join(root, 'src-tauri', 'target', 'release', sub))
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function resolveBundleRoot() {
  return resolveCargoReleaseSubdir('bundle')
}

/** Directorio `target/release` (donde Tauri deja los externalBin en Windows). */
function resolveReleaseDir() {
  const candidates = []
  const cargoTarget = process.env.CARGO_TARGET_DIR
  if (cargoTarget) candidates.push(path.join(cargoTarget, 'release'))
  candidates.push(path.join(root, 'src-tauri', 'target', 'release'))
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Basenames bajo `bundle/` (recursivo) y archivos sueltos en `target/release/` (solo nivel superior). */
function collectSidecarCandidateBasenames(bundleRoot, releaseDir) {
  const basenames = new Set()
  if (bundleRoot && fs.existsSync(bundleRoot)) {
    for (const p of walkFiles(bundleRoot)) basenames.add(path.basename(p))
  }
  if (releaseDir && fs.existsSync(releaseDir)) {
    for (const ent of fs.readdirSync(releaseDir, { withFileTypes: true })) {
      if (ent.isFile()) basenames.add(ent.name)
    }
  }
  return [...basenames]
}

/** Coincide con bin en src-tauri/bin/ (`ffmpeg-aarch64-apple-darwin`) o con copia en bundle (`ffmpeg`, `ffmpeg.exe`). */
function bundleHasSidecarBasename(basenames, stem) {
  return basenames.some((n) => {
    if (n === stem || n === `${stem}.exe`) return true
    if (n.startsWith(`${stem}-`)) return true
    return false
  })
}

async function verifyBundle() {
  const bundleRoot = resolveBundleRoot()
  const releaseDir = resolveReleaseDir()
  if (!bundleRoot && !releaseDir) {
    console.error(
      'No existe target/release ni release/bundle. Ejecuta antes `npm run tauri build`. ' +
        'Si usas CARGO_TARGET_DIR, revisa $CARGO_TARGET_DIR/release.'
    )
    process.exit(1)
  }
  const basenames = collectSidecarCandidateBasenames(bundleRoot, releaseDir)
  const ffmpegOk = bundleHasSidecarBasename(basenames, 'ffmpeg')
  const ffprobeOk = bundleHasSidecarBasename(basenames, 'ffprobe')
  const ytdlpOk = bundleHasSidecarBasename(basenames, 'yt-dlp')
  if (!ffmpegOk || !ffprobeOk || !ytdlpOk) {
    const sample = basenames.filter((n) => /ffmpeg|ffprobe|yt-dlp/i.test(n)).slice(0, 30)
    console.error(
      'Verificación: faltan sidecars ffmpeg / ffprobe / yt-dlp (se busca en release/bundle y en archivos de target/release/).',
      { bundleRoot: bundleRoot ?? null, releaseDir: releaseDir ?? null, ffmpegOk, ffprobeOk, ytdlpOk, sample }
    )
    process.exit(1)
  }
  console.log(
    `Verificación OK: ffmpeg, ffprobe y yt-dlp encontrados (bundle: ${bundleRoot ?? '—'}, release: ${releaseDir ?? '—'}).`
  )
}

async function main() {
  if (process.argv.includes('--verify-bundle')) {
    await verifyBundle()
    return
  }

  const triple = rustcTriple()
  if (triple.includes('windows')) await fetchWindows(triple)
  else if (triple.includes('apple-darwin')) await fetchMacos(triple)
  else {
    throw new Error(
      `Triple no soportado por este script: ${triple}. Instala manualmente en src-tauri/bin/ o amplía scripts/fetch-sidecars.mjs.`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
