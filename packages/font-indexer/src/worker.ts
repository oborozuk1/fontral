import { workerData, parentPort } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { readdir, stat, readFile } from 'node:fs/promises'
import { join, extname, normalize, resolve } from 'node:path'
import * as fontkit from 'fontkit'
import { cpus } from 'node:os'
import { inferFontLanguage } from './infer-language'

const extensions = new Set(['.ttf', '.otf', '.ttc', '.otc', '.woff', '.woff2'])
const searchableNameKeys = ['fontFamily', 'fullName', 'preferredFamily', 'compatibleFull', 'uniqueSubfamily', 'postscriptName', 'wwsFamilyName', 'wwsSubfamilyName'] as const
type Fingerprint = { size: number; mtimeMs: number }

// Disk-bound work: keep concurrency modest even on high core counts.
const PARSE_CONCURRENCY = Math.max(1, Math.min(3, Math.ceil((cpus().length || 4) / 2)))
const WALK_CONCURRENCY = Math.max(2, Math.min(8, cpus().length || 4))
const PROGRESS_INTERVAL_MS = 120

function encodeCmapRanges(codePoints: Iterable<number>) {
  const unique = [...new Set(
    [...codePoints].filter(point => Number.isInteger(point) && point >= 0 && point <= 0x10ffff),
  )].sort((a, b) => a - b)
  if (!unique.length) return undefined
  const ranges: number[] = []
  let start = unique[0]!
  let end = start
  for (let i = 1; i < unique.length; i += 1) {
    const point = unique[i]!
    if (point === end + 1) {
      end = point
      continue
    }
    ranges.push(start, end)
    start = point
    end = point
  }
  ranges.push(start, end)
  const bytes = Buffer.allocUnsafe(ranges.length * 4)
  for (let i = 0; i < ranges.length; i += 1) bytes.writeUInt32LE(ranges[i]!, i * 4)
  return bytes
}

function collectLocalizedSearch(font: { name?: { records?: Record<string, Record<string, unknown>> } }) {
  const records = font.name?.records
  if (!records) return undefined
  const values = new Set<string>()
  for (const key of searchableNameKeys) {
    for (const value of Object.values(records[key] ?? {})) {
      if (typeof value === 'string' && value.trim()) values.add(value.trim())
    }
  }
  return values.size ? [...values].join('\n') : undefined
}

function fingerprintMatch(known: Fingerprint | undefined, size: number, mtimeMs: number) {
  if (!known) return false
  return known.size === size && Math.round(known.mtimeMs) === Math.round(mtimeMs)
}

/**
 * Concurrent directory walk. Yields font file paths via onFile as soon as they are found
 * (does not wait for the whole tree).
 */
async function walk(dir: string, onFile: (path: string) => void): Promise<void> {
  const pending: string[] = [dir]
  let active = 0

  await new Promise<void>(resolveWalk => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolveWalk()
    }
    const pump = () => {
      if (settled) return
      while (active < WALK_CONCURRENCY && pending.length) {
        const current = pending.pop()!
        active += 1
        void readdir(current, { withFileTypes: true }).then(entries => {
          for (const entry of entries) {
            const path = join(current, entry.name)
            if (entry.isDirectory()) pending.push(path)
            else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) onFile(path)
          }
        }).catch(error => {
          // Unreadable directories are skipped (permissions / junctions).
          if ((error as NodeJS.ErrnoException)?.code !== 'EACCES' && (error as NodeJS.ErrnoException)?.code !== 'EPERM') {
            parentPort?.postMessage({ type: 'error', path: current, error: error instanceof Error ? error.message : String(error) })
          }
        }).finally(() => {
          active -= 1
          if (!pending.length && active === 0) {
            done()
            return
          }
          pump()
        })
      }
    }
    pump()
  })
}

function buildFace(font: any, faceIndex: number) {
  const axes = font.variationAxes
  const isVariable = Object.keys(axes).length > 0
  const preferredFamily = typeof font.getName === 'function' ? font.getName('preferredFamily') : undefined
  const preferredSubfamily = typeof font.getName === 'function' ? font.getName('preferredSubfamily') : undefined
  const os2Weight = font['OS/2']?.usWeightClass
  const axisWeight = axes?.wght?.default
  const weight = typeof os2Weight === 'number' && os2Weight > 0
    ? Math.min(1000, Math.max(1, Math.round(os2Weight)))
    : typeof axisWeight === 'number' && axisWeight > 0
      ? Math.min(1000, Math.max(1, Math.round(axisWeight)))
      : undefined
  const characterSet = font.characterSet ?? []
  const localizedSearch = collectLocalizedSearch(font)
  const language = inferFontLanguage(characterSet, {
    names: [font.familyName, font.fullName, preferredFamily, localizedSearch].filter((value): value is string => typeof value === 'string'),
    codePageRange1: font['OS/2']?.ulCodePageRange1,
  }) ?? undefined
  return {
    faceIndex,
    family: font.familyName || 'Unknown',
    subfamily: font.subfamilyName,
    preferredFamily: preferredFamily || undefined,
    preferredSubfamily: preferredSubfamily || undefined,
    fullName: font.fullName,
    postscriptName: font.postscriptName,
    localizedSearch,
    weight,
    isVariable,
    axesJson: isVariable ? JSON.stringify(axes) : undefined,
    glyphCount: font.numGlyphs,
    language,
    cmapRanges: encodeCmapRanges(characterSet),
  }
}

async function processFile(path: string, fingerprints: Record<string, Fingerprint>) {
  try {
    const info = await stat(path)
    const normalizedPath = normalize(resolve(path)).toLowerCase()
    if (info.size > 200 * 1024 * 1024) return
    if (fingerprintMatch(fingerprints[normalizedPath], info.size, info.mtimeMs)) {
      parentPort?.postMessage({ type: 'unchanged', normalizedPath })
      return
    }
    const bytes = await readFile(path)
    const collection: any = fontkit.create(bytes)
    const fonts: any[] = 'fonts' in collection ? collection.fonts : [collection]
    parentPort?.postMessage({
      type: 'file',
      payload: {
        rootId: workerData.rootId,
        path,
        normalizedPath,
        size: info.size,
        mtimeMs: info.mtimeMs,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        format: extname(path).slice(1).toLowerCase(),
        faces: fonts.slice(0, 256).map((font: any, faceIndex: number) => buildFace(font, faceIndex)),
      },
    })
  } catch (error) {
    parentPort?.postMessage({ type: 'error', path, error: error instanceof Error ? error.message : String(error) })
  }
}

async function main() {
  const scanPath = typeof workerData.pathPrefix === 'string' && workerData.pathPrefix.trim()
    ? workerData.pathPrefix.trim()
    : workerData.path
  const fingerprints = (workerData.fingerprints ?? {}) as Record<string, Fingerprint>

  let discovered = 0
  let processed = 0
  let walkDone = false
  let lastProgressAt = 0
  const queue: string[] = []
  let queueWaiters: Array<() => void> = []

  const wake = () => {
    const waiters = queueWaiters
    queueWaiters = []
    for (const resume of waiters) resume()
  }

  const emitProgress = (force = false) => {
    const now = Date.now()
    if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
    lastProgressAt = now
    parentPort?.postMessage({ type: 'progress', processed, total: Math.max(discovered, processed) })
  }

  parentPort?.postMessage({ type: 'start', total: 0, processed: 0 })

  const parseLoop = async () => {
    while (true) {
      if (!queue.length) {
        if (walkDone) return
        await new Promise<void>(resolve => { queueWaiters.push(resolve) })
        if (!queue.length && walkDone) return
        continue
      }
      const path = queue.shift()!
      try {
        await processFile(path, fingerprints)
      } finally {
        processed += 1
        emitProgress()
      }
    }
  }

  const parsers = Array.from({ length: PARSE_CONCURRENCY }, () => parseLoop())

  await walk(scanPath, path => {
    discovered += 1
    queue.push(path)
    wake()
    // Growing total so the UI progress bar moves during discovery.
    if (discovered === 1 || discovered % 32 === 0) emitProgress()
  })
  walkDone = true
  wake()
  await Promise.all(parsers)

  emitProgress(true)
  parentPort?.postMessage({ type: 'done' })
  parentPort?.close()
}

main().catch(error => { throw error })
