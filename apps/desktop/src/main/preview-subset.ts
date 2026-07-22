import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { extractSfntFace } from './sfnt-face'
import { createRepairedPreviewFont, needsZeroLengthVariationCmapRepair } from './preview-font-repair'
import { normalizePreviewText } from '../shared/preview-subset-text'
import type { SubsetWorkerRequest, SubsetWorkerResponse } from './preview-subset-worker'

export { normalizePreviewText, PREVIEW_LATIN_BASE, mergePreviewGlyphText } from '../shared/preview-subset-text'

/** Bump when subset payload / default glyph set changes. */
const SUBSET_VERSION = 4
const DEFAULT_CACHE_BUDGET = 256 * 1024 * 1024
const MAX_SOURCE_BYTES = 200 * 1024 * 1024
/**
 * One job per worker: harfbuzzjs keeps a single WASM heap per isolate.
 * A long-lived worker keeps subset CPU off the Electron main thread.
 */
const WORKER_COUNT = 1

type CacheEntry = { path: string; size: number; mtimeMs: number }

export type PreviewSubsetRequest = {
  path: string
  sha256: string
  format: string | null
  faceIndex: number
  text: string
  size: number
  mtimeMs: number
}

type PendingJob = {
  resolve: (value: { body: Buffer; fullFace: boolean }) => void
  reject: (error: Error) => void
}

class SubsetWorkerPool {
  private readonly workerFile: string
  private readonly size: number
  private readonly workers: Worker[] = []
  private readonly free: Worker[] = []
  private readonly waiters: Array<(worker: Worker) => void> = []
  private readonly pending = new Map<number, PendingJob>()
  private nextId = 1
  private closed = false

  constructor(workerFile: string, size = WORKER_COUNT) {
    this.workerFile = workerFile
    this.size = Math.max(1, size)
  }

  async subset(face: Buffer, text: string): Promise<{ body: Buffer; fullFace: boolean }> {
    if (this.closed) throw new Error('Subset worker pool closed')
    const worker = await this.acquire()
    const id = this.nextId++
    try {
      return await new Promise<{ body: Buffer; fullFace: boolean }>((resolve, reject) => {
        this.pending.set(id, {
          resolve: value => {
            this.pending.delete(id)
            resolve(value)
          },
          reject: error => {
            this.pending.delete(id)
            reject(error)
          },
        })
        // Copy so the worker owns independent memory; main may reuse `face` for full-face fallback.
        const copy = new Uint8Array(face.byteLength)
        copy.set(face)
        const payload: SubsetWorkerRequest = { id, face: copy, text }
        try {
          worker.postMessage(payload, [copy.buffer])
        } catch (error) {
          this.pending.delete(id)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    } finally {
      // Skip if dropWorker already removed this isolate.
      if (this.workers.includes(worker)) this.release(worker)
    }
  }

  async close() {
    this.closed = true
    for (const job of this.pending.values()) {
      job.reject(new Error('Subset worker pool closed'))
    }
    this.pending.clear()
    this.waiters.length = 0
    const workers = this.workers.splice(0, this.workers.length)
    this.free.length = 0
    await Promise.all(workers.map(worker => worker.terminate().catch(() => 0)))
  }

  private async acquire(): Promise<Worker> {
    const idle = this.free.pop()
    if (idle) return idle
    if (this.workers.length < this.size) {
      const worker = this.spawn()
      this.workers.push(worker)
      return worker
    }
    return new Promise<Worker>(resolve => {
      this.waiters.push(resolve)
    })
  }

  private release(worker: Worker) {
    if (this.closed) return
    const next = this.waiters.shift()
    if (next) next(worker)
    else this.free.push(worker)
  }

  private spawn() {
    const worker = new Worker(this.workerFile, { execArgv: process.execArgv })
    worker.on('message', (message: SubsetWorkerResponse) => this.onMessage(message))
    worker.on('error', error => this.dropWorker(worker, error))
    worker.on('exit', code => {
      if (this.closed) return
      if (code === 0) return
      this.dropWorker(worker, new Error(`Subset worker stopped with code ${code}`))
    })
    return worker
  }

  private onMessage(message: SubsetWorkerResponse) {
    const job = this.pending.get(message.id)
    if (!job) return
    if (!message.ok) {
      job.reject(new Error(message.error || 'Subset failed'))
      return
    }
    if (message.fullFace) {
      job.resolve({ body: Buffer.alloc(0), fullFace: true })
      return
    }
    job.resolve({ body: Buffer.from(message.body), fullFace: false })
  }

  private dropWorker(worker: Worker, error: Error) {
    const index = this.workers.indexOf(worker)
    if (index >= 0) this.workers.splice(index, 1)
    const freeIndex = this.free.indexOf(worker)
    if (freeIndex >= 0) this.free.splice(freeIndex, 1)
    for (const job of this.pending.values()) job.reject(error)
    this.pending.clear()
    void worker.terminate().catch(() => 0)
    // Respawn for waiters so a crashed isolate does not stall the pool forever.
    while (this.waiters.length && this.workers.length < this.size && !this.closed) {
      const next = this.waiters.shift()
      if (!next) break
      const replacement = this.spawn()
      this.workers.push(replacement)
      next(replacement)
    }
  }
}

export class PreviewSubsetService {
  private readonly cacheRoot: string
  private readonly budget: number
  private readonly pool: SubsetWorkerPool
  private readonly repairChecks = new Map<string, Promise<boolean>>()
  private readonly repairs = new Map<string, Promise<string>>()
  private readonly inflight = new Map<string, Promise<Buffer>>()
  private cacheIndex: CacheEntry[] | null = null

  constructor(cacheRoot: string, workerFile: string, budget = DEFAULT_CACHE_BUDGET) {
    this.cacheRoot = cacheRoot
    this.budget = budget
    this.pool = new SubsetWorkerPool(workerFile, WORKER_COUNT)
  }

  clearMemory() {
    this.repairChecks.clear()
    this.repairs.clear()
    this.inflight.clear()
    this.cacheIndex = null
  }

  async clearAll() {
    this.clearMemory()
    await rm(this.cacheRoot, { recursive: true, force: true })
  }

  async dispose() {
    this.clearMemory()
    await this.pool.close()
  }

  async getFullFace(request: Omit<PreviewSubsetRequest, 'text'>): Promise<{ body: Buffer; contentType: string }> {
    const fullPath = this.fullFaceCachePath(request.sha256, request.faceIndex)
    try {
      const body = await readFile(fullPath)
      void this.touch(fullPath, body.length).catch(() => undefined)
      return { body, contentType: 'font/ttf' }
    } catch {
      /* cache miss */
    }

    const key = `full:${request.sha256}:${request.faceIndex}`
    let pending = this.inflight.get(key)
    if (!pending) {
      pending = (async () => {
        if (request.size > MAX_SOURCE_BYTES) throw new Error('Font too large')
        const sourcePath = await this.previewSourcePath(request)
        const source = await readFile(sourcePath)
        const face = extractSfntFace(source, request.faceIndex)
        await this.writeCache(fullPath, face)
        return face
      })()
      pending.catch(() => undefined)
      this.inflight.set(key, pending)
      pending.finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key)
      })
    }
    const body = await pending
    return { body, contentType: 'font/ttf' }
  }

  async getSubset(request: PreviewSubsetRequest): Promise<{ body: Buffer; contentType: string }> {
    const text = normalizePreviewText(request.text)
    const key = cacheKey(request.sha256, request.faceIndex, text)
    const cachedPath = this.cachePath(request.sha256, key)
    try {
      const body = await readFile(cachedPath)
      void this.touch(cachedPath, body.length).catch(() => undefined)
      return { body, contentType: 'font/ttf' }
    } catch {
      /* cache miss */
    }

    // Reuse a previous full-face fallback for this face (subset permanently failed).
    const fullPath = this.fullFaceCachePath(request.sha256, request.faceIndex)
    try {
      const body = await readFile(fullPath)
      void this.touch(fullPath, body.length).catch(() => undefined)
      return { body, contentType: 'font/ttf' }
    } catch {
      /* no full-face cache */
    }

    let pending = this.inflight.get(key)
    if (!pending) {
      pending = this.buildSubset(request, text, cachedPath, fullPath)
      pending.catch(() => undefined)
      this.inflight.set(key, pending)
      pending.finally(() => {
        if (this.inflight.get(key) === pending) this.inflight.delete(key)
      })
    }
    const body = await pending
    return { body, contentType: 'font/ttf' }
  }

  private async buildSubset(
    request: PreviewSubsetRequest,
    text: string,
    cachedPath: string,
    fullPath: string,
  ) {
    if (request.size > MAX_SOURCE_BYTES) throw new Error('Font too large')
    const sourcePath = await this.previewSourcePath(request)
    const source = await readFile(sourcePath)
    const face = extractSfntFace(source, request.faceIndex)
    const subsetText = text.length ? text : ' '

    let body: Buffer
    let fullFace = false
    try {
      const result = await this.pool.subset(face, subsetText)
      if (result.fullFace) {
        body = face
        fullFace = true
      } else {
        body = result.body
      }
    } catch {
      body = face
      fullFace = true
    }

    await this.writeCache(fullFace ? fullPath : cachedPath, body)
    return body
  }

  private async previewSourcePath(request: Pick<PreviewSubsetRequest, 'path' | 'sha256' | 'format' | 'size' | 'mtimeMs'>) {
    if (request.format?.toLowerCase() !== 'ttf') return request.path
    const key = `${request.path}\n${request.size}\n${request.mtimeMs}`
    let check = this.repairChecks.get(key)
    if (!check) {
      check = needsZeroLengthVariationCmapRepair(request.path).catch(() => false)
      this.repairChecks.set(key, check)
    }
    if (!await check) return request.path

    let repair = this.repairs.get(request.sha256)
    if (!repair) {
      const cachePath = join(this.cacheRoot, 'repaired', `${request.sha256}.cmap14-v2.ttf`)
      repair = createRepairedPreviewFont(request.path, cachePath)
      repair.catch(() => undefined)
      this.repairs.set(request.sha256, repair)
    }
    return repair
  }

  private cachePath(sha256: string, key: string) {
    return join(this.cacheRoot, sha256.slice(0, 2), sha256, `${key}.ttf`)
  }

  private fullFaceCachePath(sha256: string, faceIndex: number) {
    return this.cachePath(sha256, `full-face-${faceIndex}-v${SUBSET_VERSION}`)
  }

  private async writeCache(path: string, body: Buffer) {
    try {
      await mkdir(join(path, '..'), { recursive: true })
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporary, body)
      await rename(temporary, path)
      this.cacheIndex = null
      void this.enforceBudget().catch(() => undefined)
    } catch {
      /* best-effort cache */
    }
  }

  private async touch(path: string, size: number) {
    try {
      const now = new Date()
      await utimes(path, now, now)
      if (this.cacheIndex) {
        const entry = this.cacheIndex.find(item => item.path === path)
        if (entry) {
          entry.mtimeMs = now.getTime()
          entry.size = size
        }
      }
    } catch { /* ignore */ }
  }

  private async enforceBudget() {
    try {
      const entries = await this.listCacheEntries()
      let total = entries.reduce((sum, item) => sum + item.size, 0)
      if (total <= this.budget) return
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
      for (const entry of entries) {
        if (total <= this.budget) break
        try {
          await unlink(entry.path)
          total -= entry.size
        } catch { /* ignore */ }
      }
      this.cacheIndex = null
    } catch { /* ignore */ }
  }

  private async listCacheEntries() {
    if (this.cacheIndex) return this.cacheIndex
    const entries: CacheEntry[] = []
    if (!existsSync(this.cacheRoot)) {
      this.cacheIndex = entries
      return entries
    }
    const stack = [this.cacheRoot]
    while (stack.length) {
      const dir = stack.pop()!
      let items: string[] = []
      try { items = await readdir(dir) } catch { continue }
      for (const name of items) {
        const path = join(dir, name)
        try {
          const info = await stat(path)
          if (info.isDirectory()) stack.push(path)
          else if (info.isFile() && name.endsWith('.ttf')) {
            entries.push({ path, size: info.size, mtimeMs: info.mtimeMs })
          }
        } catch { /* ignore */ }
      }
    }
    this.cacheIndex = entries
    return entries
  }
}

function cacheKey(sha256: string, faceIndex: number, text: string) {
  const digest = createHash('sha1')
    .update(String(SUBSET_VERSION))
    .update('\0')
    .update(sha256)
    .update('\0')
    .update(String(faceIndex))
    .update('\0')
    .update(text)
    .digest('hex')
    .slice(0, 24)
  return digest
}
