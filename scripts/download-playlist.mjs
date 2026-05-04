#!/usr/bin/env node
/**
 * Versión CLI del script de referencia (`music-download/download.playlist.js`).
 * Misma interfaz: `node scripts/download-playlist.mjs --config "./playlist.json"`
 *
 * Requisitos: `yt-dlp` y `ffmpeg` en PATH; dependencia `node-id3` (ya en el proyecto).
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const NodeID3 = require('node-id3')

function parseArgs(argv) {
  const args = { config: './playlist.json' }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--config') args.config = argv[++i] || './playlist.json'
  }
  return args
}

function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      process.stderr.write(text)
    })

    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(
          new Error(`${command} exited with code ${code}\n${stderr || stdout || 'No output'}`)
        )
      }
    })
  })
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function safeDirName(name) {
  const raw = String(name ?? 'Unknown Playlist').trim() || 'Unknown Playlist'
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'Unknown Playlist'
  return cleaned
}

function youtubeSingleVideoUrl(url) {
  const s = String(url || '').trim()
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
    /* ignore */
  }
  return s
}

const REQUIRED_TRACK_KEYS = ['fileName', 'artist', 'album', 'trackNumber', 'title', 'videoUrl']

function assertConfigShape(configJson) {
  if (!configJson || typeof configJson !== 'object') {
    throw new Error('Invalid config root object.')
  }
  if (!configJson.playlist || String(configJson.playlist).trim() === '') {
    throw new Error('Config must include non-empty root "playlist" (folder name under out).')
  }
  if (!Array.isArray(configJson.tracks) || configJson.tracks.length === 0) {
    throw new Error("Config must include a non-empty 'tracks' array.")
  }
  configJson.tracks.forEach((track, index) => {
    for (const key of REQUIRED_TRACK_KEYS) {
      const value = track[key]
      if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`tracks[${index}] must include non-empty "${key}"`)
      }
    }
  })
}

async function downloadTrack(track, outputDir) {
  const url = youtubeSingleVideoUrl(track.videoUrl)
  if (!url) {
    throw new Error(`Missing videoUrl for "${track.title}"`)
  }

  const targetPath = path.join(outputDir, track.fileName)
  const outputTpl = `${targetPath.replace(/\.mp3$/i, '')}.%(ext)s`
  const args = ['-x', '--audio-format', 'mp3', '--no-playlist', '-o', outputTpl, url]
  await runCommand('yt-dlp', args)
}

function mimeFromCoverPath(coverAbsolutePath) {
  const ext = path.extname(coverAbsolutePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

function buildImageTag(coverAbsolutePath) {
  return {
    mime: mimeFromCoverPath(coverAbsolutePath),
    type: { id: 3, name: 'front cover' },
    description: 'Cover',
    imageBuffer: fs.readFileSync(coverAbsolutePath)
  }
}

function applyTags(outputDir, track, configDir, rootCoverPath) {
  const mp3Path = path.join(outputDir, track.fileName)

  if (!fs.existsSync(mp3Path)) {
    console.warn(`Skipping tags, file not found: ${track.fileName}`)
    return
  }

  let existing = {}
  try {
    existing = NodeID3.read(mp3Path) || {}
  } catch {
    existing = {}
  }

  const { raw: _raw, ...kept } = existing

  const tags = {
    ...kept,
    title: track.title,
    artist: track.artist,
    album: track.album,
    trackNumber: track.trackNumber,
    comment: {
      language: 'eng',
      text: youtubeSingleVideoUrl(track.videoUrl) || String(track.videoUrl)
    }
  }

  if (rootCoverPath && String(rootCoverPath).trim()) {
    const coverAbsolutePath = path.resolve(configDir, String(rootCoverPath).trim())
    if (fs.existsSync(coverAbsolutePath)) {
      tags.image = buildImageTag(coverAbsolutePath)
    } else {
      console.warn(`Cover not found: ${rootCoverPath}`)
    }
  }

  const ok = NodeID3.write(tags, mp3Path)
  if (ok !== true) {
    console.warn(`Could not write tags: ${mp3Path}`, ok && ok.message ? ok.message : '')
  } else {
    console.log(`Tagged: ${mp3Path}`)
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const configPath = path.resolve(args.config)
  const configDir = path.dirname(configPath)

  if (!fs.existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`)

  const configJson = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assertConfigShape(configJson)
  const tracks = configJson.tracks

  const outRelative = String(configJson.out ?? '').trim() || 'downloads'
  if (!String(configJson.out ?? '').trim()) {
    console.log('Note: no root "out" in config; using default "downloads" (relative to JSON file).')
  }
  const baseOut = path.resolve(configDir, outRelative)
  const playlistLabel = String(configJson.playlist).trim()
  const playlistFolder = safeDirName(playlistLabel)
  const playlistDir = path.join(baseOut, playlistFolder)
  const rootCoverPath = configJson.coverPath ? String(configJson.coverPath).trim() : ''

  ensureDir(baseOut)
  ensureDir(playlistDir)

  console.log(`Loaded ${tracks.length} tracks from ${configPath}`)
  console.log(`Output folder: ${playlistDir}`)

  const skippedTracks = []

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i]
    const mp3Path = path.join(playlistDir, track.fileName)
    console.log(`\n[${i + 1}/${tracks.length}] ${track.title}`)

    if (fs.existsSync(mp3Path)) {
      console.log(`  Skip download (already exists): ${track.fileName}`)
    } else {
      console.log(`  Downloading…`)
      try {
        await downloadTrack(track, playlistDir)
      } catch (err) {
        const firstLine = String(err.message || err).split('\n')[0].trim()
        console.error(`  Skipped (download failed): ${firstLine}`)
        skippedTracks.push({
          index: i + 1,
          fileName: track.fileName,
          title: track.title,
          videoUrl: track.videoUrl,
          error: firstLine
        })
        continue
      }
    }

    try {
      applyTags(playlistDir, track, configDir, rootCoverPath)
    } catch (err) {
      const firstLine = String(err.message || err).split('\n')[0].trim()
      console.error(`  Skipped (tags failed): ${firstLine}`)
      skippedTracks.push({
        index: i + 1,
        fileName: track.fileName,
        title: track.title,
        videoUrl: track.videoUrl,
        error: `tags: ${firstLine}`
      })
    }
  }

  if (skippedTracks.length > 0) {
    console.log(`\nFinished with ${skippedTracks.length} skipped track(s) (errors above).`)
  }

  const summaryPath = path.join(playlistDir, 'metadata.applied.json')
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        playlist: playlistLabel,
        out: outRelative,
        coverPath: rootCoverPath || undefined,
        generatedAt: new Date().toISOString(),
        skippedTracks: skippedTracks.length ? skippedTracks : undefined,
        tracks
      },
      null,
      2
    ),
    'utf8'
  )
  console.log(`\nSummary written: ${summaryPath}`)

  console.log('Done.')
}

main().catch((err) => {
  console.error('\nError:', err.message)
  process.exitCode = 1
})
