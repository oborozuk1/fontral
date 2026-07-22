import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ActivationAgentResponse, ActivationError, ActivationRecord, ActivationTarget } from '../../../packages/contracts/src/index'
import { activationAgentRequestSchema } from '../../../packages/contracts/src/index'
import { createPlatformAdapter, PlatformActivationError } from './platform-adapter'

interface Journal { sessionId: string; mainPid: number; records: ActivationRecord[]; targets: Record<string, ActivationTarget> }

const endpoint = required('FONTRAL_AGENT_ENDPOINT')
const token = required('FONTRAL_AGENT_TOKEN')
const sessionId = required('FONTRAL_AGENT_SESSION_ID')
const mainPid = Number(required('FONTRAL_AGENT_MAIN_PID'))
const journalDirectory = required('FONTRAL_AGENT_JOURNAL_DIR')
const journalPath = join(journalDirectory, `${sessionId}.json`)
const adapter = createPlatformAdapter()
const records = new Map<number, ActivationRecord>()
const targets = new Map<number, ActivationTarget>()
const isolatedProcesses = new Map<number, ChildProcess>()
let cleaning = false
let shuttingDown = false

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value }
function processExists(pid: number) { try { process.kill(pid, 0); return true } catch { return false } }
function errorDetail(cause: unknown, fallback: ActivationError['code']): ActivationError {
  if (cause instanceof PlatformActivationError) return cause.detail
  return { code: fallback, message: cause instanceof Error ? cause.message : String(cause), retryable: true }
}
function persist() {
  mkdirSync(journalDirectory, { recursive: true })
  const journal: Journal = { sessionId, mainPid, records: [...records.values()], targets: Object.fromEntries([...targets].map(([id, target]) => [String(id), target])) }
  const temporary = `${journalPath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(journal), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, journalPath)
}
function removeJournal() { rmSync(journalPath, { force: true }) }
function isolatedToken(pid: number, directory: string) { return `isolated:${pid}:${Buffer.from(directory).toString('base64url')}` }
function parseIsolatedToken(value: string | null) {
  if (!value?.startsWith('isolated:')) return null
  const [, pid, encoded] = value.split(':')
  if (!pid || !encoded) return null
  return { pid: Number(pid), directory: Buffer.from(encoded, 'base64url').toString('utf8') }
}
function stopIsolated(value: string | null) {
  const isolated = parseIsolatedToken(value)
  if (!isolated) return false
  try { process.kill(-isolated.pid, 'SIGTERM') } catch { try { process.kill(isolated.pid, 'SIGTERM') } catch { /* Process already exited. */ } }
  rmSync(isolated.directory, { recursive: true, force: true })
  return true
}
function makeRecord(target: ActivationTarget, status: ActivationRecord['status'], error: ActivationError | null = null, platformToken: string | null = null, ownedRefCount = 0): ActivationRecord {
  return { sessionId, faceId: target.faceId, fileId: target.fileId, faceIds: [target.faceId], path: target.path, sha256: target.sha256, status, ownedRefCount, platformToken, error, updatedAt: Date.now() }
}

async function recoverJournals() {
  mkdirSync(journalDirectory, { recursive: true })
  const failures: string[] = []
  for (const name of readdirSync(journalDirectory)) {
    if (!name.endsWith('.json') || name === `${sessionId}.json`) continue
    const path = join(journalDirectory, name)
    try {
      const journal = JSON.parse(readFileSync(path, 'utf8')) as Journal
      if (processExists(journal.mainPid)) continue
      for (const record of journal.records) {
        if (stopIsolated(record.platformToken)) continue
        if (record.ownedRefCount <= 0) continue
        const target = journal.targets[String(record.fileId)]
        if (!target) continue
        for (let count = 0; count < record.ownedRefCount; count += 1) await adapter.deactivate(target, record.platformToken)
      }
      rmSync(path, { force: true })
    } catch { failures.push(name) }
  }
  if (failures.length) throw new Error(`Unable to recover activation journals: ${failures.join(', ')}`)
}

async function launchIsolated(target: ActivationTarget, executable: string) {
  if (process.platform !== 'linux') throw new PlatformActivationError({ code: 'unsupported_platform', message: '隔离启动模式仅适用于 Linux。', retryable: false })
  const availability = await adapter.check(target)
  if (availability.kind === 'conflict') {
    const record = makeRecord(target, 'conflict', { code: 'postscript_name_conflict', message: availability.message ?? 'PostScript name 冲突。', retryable: false })
    targets.set(target.fileId, target); records.set(target.fileId, record); persist(); return record
  }
  const runtimeRoot = process.env.XDG_RUNTIME_DIR || tmpdir()
  const directory = join(runtimeRoot, 'fontral', sessionId, String(target.fileId))
  const fontsDirectory = join(directory, 'fonts')
  const cacheDirectory = join(directory, 'cache')
  const configPath = join(directory, 'fonts.conf')
  mkdirSync(fontsDirectory, { recursive: true, mode: 0o700 })
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 })
  symlinkSync(target.path, join(fontsDirectory, `font${extname(target.path).toLowerCase()}`), 'file')
  writeFileSync(configPath, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>${fontsDirectory}</dir><cachedir>${cacheDirectory}</cachedir></fontconfig>`, { mode: 0o600 })
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', env: { ...process.env, FONTCONFIG_FILE: configPath, FONTCONFIG_PATH: dirname(configPath) } })
  if (!child.pid) throw new Error('无法启动目标程序。')
  child.unref()
  isolatedProcesses.set(target.fileId, child)
  targets.set(target.fileId, target)
  const record = makeRecord(target, 'active', null, isolatedToken(child.pid, directory), 0)
  records.set(target.fileId, record); persist()
  child.once('exit', () => {
    isolatedProcesses.delete(target.fileId)
    rmSync(directory, { recursive: true, force: true })
    if (records.get(target.fileId)?.platformToken !== record.platformToken) return
    records.set(target.fileId, makeRecord(target, 'inactive'))
    persist()
  })
  return record
}

async function activate(target: ActivationTarget) {
  const existing = records.get(target.fileId)
  if (existing?.status === 'active' || existing?.status === 'already_available') return existing
  targets.set(target.fileId, target)
  records.set(target.fileId, makeRecord(target, 'activating'))
  persist()
  try {
    const availability = await adapter.check(target)
    if (availability.kind === 'available') {
      const record = makeRecord(target, 'already_available', { code: 'system_already_available', message: '系统已提供相同字体，无需重复激活。', retryable: false })
      records.set(target.fileId, record); persist(); return record
    }
    if (availability.kind === 'conflict') {
      const record = makeRecord(target, 'conflict', { code: 'postscript_name_conflict', message: availability.message ?? 'PostScript name 冲突。', retryable: false })
      records.set(target.fileId, record); persist(); return record
    }
    const platformToken = await adapter.activate(target)
    const record = makeRecord(target, 'active', null, platformToken, 1)
    records.set(target.fileId, record); persist(); return record
  } catch (cause) {
    const record = makeRecord(target, 'failed', errorDetail(cause, 'platform_registration_failed'))
    records.set(target.fileId, record); persist(); return record
  }
}

async function deactivate(fileId: number) {
  const record = records.get(fileId)
  const target = targets.get(fileId)
  if (!record || !target) throw new PlatformActivationError({ code: 'cleanup_failed', message: '找不到该激活记录。', retryable: false })
  if (stopIsolated(record.platformToken)) {
    isolatedProcesses.delete(fileId)
    const inactive = makeRecord(target, 'inactive')
    records.set(fileId, inactive); persist(); return inactive
  }
  if (record.ownedRefCount <= 0) {
    const inactive = makeRecord(target, 'inactive')
    records.set(fileId, inactive); persist(); return inactive
  }
  records.set(fileId, { ...record, status: 'deactivating', updatedAt: Date.now() }); persist()
  try {
    for (let count = 0; count < record.ownedRefCount; count += 1) await adapter.deactivate(target, record.platformToken)
    const inactive = makeRecord(target, 'inactive')
    records.set(fileId, inactive); persist(); return inactive
  } catch (cause) {
    const failed = { ...record, status: 'failed' as const, error: errorDetail(cause, 'platform_unregistration_failed'), updatedAt: Date.now() }
    records.set(fileId, failed); persist(); return failed
  }
}

async function deactivateAll() {
  if (cleaning) return [...records.values()]
  cleaning = true
  try {
    for (const [fileId, record] of records) if (record.ownedRefCount > 0 || parseIsolatedToken(record.platformToken)) await deactivate(fileId)
    if ([...records.values()].every(record => record.ownedRefCount === 0 && !parseIsolatedToken(record.platformToken))) removeJournal()
    return [...records.values()]
  } finally { cleaning = false }
}

function send(socket: Socket, response: ActivationAgentResponse) { socket.write(`${JSON.stringify(response)}\n`) }
function listen(socket: Socket) {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', chunk => {
    buffer += String(chunk)
    void (async () => {
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        let id: string = randomUUID()
        try {
          const request = activationAgentRequestSchema.parse(JSON.parse(line)); id = request.id
          if (request.token !== token) { send(socket, { id, ok: false, error: { code: 'agent_auth_failed', message: 'Activation Agent token is invalid.', retryable: false } }); continue }
          if (request.command === 'handshake') send(socket, { id, ok: true })
          else if (request.command === 'list') send(socket, { id, ok: true, records: [...records.values()] })
          else if (request.command === 'activate' && request.target) send(socket, { id, ok: true, record: await activate(request.target) })
          else if (request.command === 'launchIsolated' && request.target && request.executable) send(socket, { id, ok: true, record: await launchIsolated(request.target, request.executable) })
          else if (request.command === 'deactivate' && request.fileId) send(socket, { id, ok: true, record: await deactivate(request.fileId) })
          else if (request.command === 'deactivateAll') send(socket, { id, ok: true, records: await deactivateAll() })
          else if (request.command === 'shutdown') { await deactivateAll(); send(socket, { id, ok: true }); shuttingDown = true; setTimeout(() => process.exit(0), 20) }
          else send(socket, { id, ok: false, error: { code: 'agent_unavailable', message: 'Activation Agent request is incomplete.', retryable: false } })
        } catch (cause) { send(socket, { id, ok: false, error: errorDetail(cause, 'agent_unavailable') }) }
      }
    })()
  })
}

await recoverJournals()
if (process.platform !== 'win32' && existsSync(endpoint)) rmSync(endpoint, { force: true })
const server = createServer(listen)
server.listen(endpoint)
const monitor = setInterval(() => {
  if (shuttingDown || processExists(mainPid)) return
  clearInterval(monitor)
  void deactivateAll().finally(() => { server.close(); setTimeout(() => process.exit(0), 20) })
}, 500)
process.on('SIGTERM', () => { void deactivateAll().finally(() => process.exit(0)) })
