import type { DownloadProgress } from '../lib/types/downloads.types'

/** `[download] 45.3% of 12.31MiB at 1.2MiB/s ETA 00:12` */
const RE_WITH_ETA =
  /^\[download\]\s+([\d.]+)%\s+of\s+(.+?)\s+at\s+(.+?)\s+ETA\s+(.+)$/

/** `[download] 100% of    4.08MiB in 00:00:00 at 5.59MiB/s` */
const RE_WITH_IN =
  /^\[download\]\s+([\d.]+)%\s+of\s+(.+?)\s+in\s+(\S+)\s+at\s+(.+)$/

function clampPercent(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(100, Math.max(0, n))
}

/**
 * Interpreta líneas de progreso estándar de yt-dlp (`--progress` / descarga).
 * Devuelve `null` si la línea no contiene progreso reconocible.
 */
export function parseYtdlpDownloadLine(line: string): DownloadProgress | null {
  const trimmed = line.trim()

  const mEta = RE_WITH_ETA.exec(trimmed)
  if (mEta) {
    const pct = parseFloat(mEta[1])
    return {
      percent: clampPercent(pct),
      totalSizeLabel: mEta[2].trim(),
      speed: mEta[3].trim(),
      eta: mEta[4].trim(),
      rawLine: line
    }
  }

  const mIn = RE_WITH_IN.exec(trimmed)
  if (mIn) {
    const pct = parseFloat(mIn[1])
    return {
      percent: clampPercent(pct),
      totalSizeLabel: mIn[2].trim(),
      speed: mIn[4].trim(),
      eta: mIn[3].trim(),
      rawLine: line
    }
  }

  return null
}
