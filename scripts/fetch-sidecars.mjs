#!/usr/bin/env node
/**
 * Descarga ffmpeg, ffprobe y yt-dlp con los nombres que espera Tauri 2 (`externalBin`).
 * Usa el triple de `rustc -vV` (coincide con el sufijo del host de build en CI).
 *
 * Uso:
 *   node scripts/fetch-sidecars.mjs
 *   node scripts/fetch-sidecars.mjs --verify-bundle   # tras `npm run tauri build`
 *
 * En el bundle final Tauri suele publicar los binarios como `ffmpeg`, `ffprobe`, `yt-dlp`
 * (no como `ffmpeg-<triple>`); la verificación acepta ambas formas.
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

function resolveBundleRoot() {
  const candidates = []
  const cargoTarget = process.env.CARGO_TARGET_DIR
  if (cargoTarget) candidates.push(path.join(cargoTarget, 'release', 'bundle'))
  candidates.push(path.join(root, 'src-tauri', 'target', 'release', 'bundle'))
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
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
  if (!bundleRoot) {
    console.error(
      'No existe release/bundle. Ejecuta antes `npm run tauri build`. ' +
        'Si usas CARGO_TARGET_DIR, el bundle debe estar en $CARGO_TARGET_DIR/release/bundle.'
    )
    process.exit(1)
  }
  const files = walkFiles(bundleRoot)
  const basenames = files.map((p) => path.basename(p))
  const ffmpegOk = bundleHasSidecarBasename(basenames, 'ffmpeg')
  const ffprobeOk = bundleHasSidecarBasename(basenames, 'ffprobe')
  const ytdlpOk = bundleHasSidecarBasename(basenames, 'yt-dlp')
  if (!ffmpegOk || !ffprobeOk || !ytdlpOk) {
    const sample = basenames.filter((n) => /ffmpeg|ffprobe|yt-dlp/i.test(n)).slice(0, 30)
    console.error(
      'Verificación bundle: faltan sidecars ffmpeg / ffprobe / yt-dlp bajo release/bundle.',
      { bundleRoot, ffmpegOk, ffprobeOk, ytdlpOk, sample }
    )
    process.exit(1)
  }
  console.log(`Verificación bundle OK (${bundleRoot}): ffmpeg, ffprobe y yt-dlp presentes.`)
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
