import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivationTarget } from '@fontral/contracts'
import { ActivationClient } from './index'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function fixture(mainPid = process.pid, environment: NodeJS.ProcessEnv = {}, timeoutMs = 5_000) {
  const directory = join(tmpdir(), `fontral-agent-test-${randomUUID()}`)
  const journals = join(directory, 'journals')
  mkdirSync(journals, { recursive: true })
  const path = join(directory, 'font.ttf')
  const bytes = Buffer.from('fake-font-content')
  writeFileSync(path, bytes)
  directories.push(directory)
  const sessionId = randomUUID()
  const target = (client: ActivationClient): ActivationTarget => ({
    sessionId: client.sessionId,
    faceId: 1,
    fileId: 1,
    fileIdentity: null,
    normalizedPath: path.toLowerCase(),
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    postscriptNames: ['FakeFont-Regular'],
  })
  const client = new ActivationClient({
    agentEntry: resolve('apps/desktop/out/main/activation-agent.js'),
    journalDirectory: journals,
    mainPid,
    timeoutMs,
    environment: { FONTRAL_ACTIVATION_ADAPTER: 'fake', ...environment },
  })
  return { client, journals, target: () => target(client), sessionId }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Condition was not met before timeout.')
}

describe('ActivationClient integration', () => {
  it('activates, lists, and deactivates through the authenticated Agent', async () => {
    const { client, target } = fixture()
    await client.start()
    const active = await client.activate(target())
    expect(active.status).toBe('active')
    expect(active.ownedRefCount).toBe(1)
    expect((await client.list())[0]?.status).toBe('active')
    const inactive = await client.deactivate(target().fileId)
    expect(inactive.status).toBe('inactive')
    expect(inactive.ownedRefCount).toBe(0)
    expect(await client.deactivateAll()).toEqual(await client.deactivateAll())
    await client.stop()
  })

  it('returns conflict without acquiring an owned reference', async () => {
    const { client, target } = fixture(process.pid, { FONTRAL_FAKE_AVAILABILITY: 'conflict' })
    await client.start()
    const record = await client.activate(target())
    expect(record.status).toBe('conflict')
    expect(record.error?.code).toBe('postscript_name_conflict')
    expect(record.ownedRefCount).toBe(0)
    await client.stop()
  })

  it('detects a changed file hash before registration', async () => {
    const { client, target } = fixture()
    await client.start()
    const changed = { ...target(), sha256: '0'.repeat(64) }
    const record = await client.activate(changed)
    expect(record.status).toBe('failed')
    expect(record.error?.code).toBe('file_hash_changed')
    await client.stop()
  })

  it('times out a stalled command', async () => {
    const { client, target } = fixture(process.pid, { FONTRAL_FAKE_DELAY_MS: '700' }, 300)
    await client.start()
    await expect(client.activate(target())).rejects.toMatchObject({ detail: { code: 'agent_timeout' } })
    await new Promise(resolve => setTimeout(resolve, 750))
    await client.stop()
  })

  it('cleans its journal when the monitored Main PID disappears', async () => {
    const monitored = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
    const { client, journals, target } = fixture(monitored.pid!)
    await client.start()
    await client.activate(target())
    const journal = join(journals, `${client.sessionId}.json`)
    expect(existsSync(journal)).toBe(true)
    monitored.kill()
    await waitUntil(() => !existsSync(journal))
  })
})
