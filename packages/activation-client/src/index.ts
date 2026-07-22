import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActivationAgentRequest, ActivationAgentResponse, ActivationError, ActivationRecord, ActivationTarget } from '@fontral/contracts'
import { activationAgentResponseSchema } from '@fontral/contracts'

export interface ActivationClientOptions {
  agentEntry: string
  journalDirectory: string
  mainPid?: number
  timeoutMs?: number
  executable?: string
  environment?: NodeJS.ProcessEnv
}

export class ActivationClientError extends Error {
  constructor(public readonly detail: ActivationError) {
    super(detail.message)
    this.name = 'ActivationClientError'
  }
}

export class ActivationClient {
  readonly sessionId = randomUUID()
  private readonly token = randomBytes(32).toString('hex')
  private readonly timeoutMs: number
  private readonly endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\fontral-activation-${randomUUID()}`
    : join(tmpdir(), `fontral-activation-${randomUUID()}.sock`)
  private child?: ChildProcess
  private socket?: Socket
  private buffer = ''
  private readonly pending = new Map<string, { resolve(value: ActivationAgentResponse): void; reject(error: Error): void; timer: NodeJS.Timeout }>()

  constructor(private readonly options: ActivationClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  get agentPid() { return this.child?.pid }

  async start() {
    if (this.socket) return
    this.child = spawn(this.options.executable ?? process.execPath, [this.options.agentEntry], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        ...this.options.environment,
        ELECTRON_RUN_AS_NODE: '1',
        FONTRAL_AGENT_ENDPOINT: this.endpoint,
        FONTRAL_AGENT_TOKEN: this.token,
        FONTRAL_AGENT_SESSION_ID: this.sessionId,
        FONTRAL_AGENT_MAIN_PID: String(this.options.mainPid ?? process.pid),
        FONTRAL_AGENT_JOURNAL_DIR: this.options.journalDirectory,
      },
    })
    this.child.unref()
    await this.connect()
    await this.request('handshake')
  }

  private async connect() {
    const deadline = Date.now() + this.timeoutMs
    let lastError: Error | undefined
    while (Date.now() < deadline) {
      try {
        this.socket = await new Promise<Socket>((resolve, reject) => {
          const socket = createConnection(this.endpoint)
          socket.once('connect', () => resolve(socket))
          socket.once('error', reject)
        })
        this.socket.setEncoding('utf8')
        this.socket.on('data', chunk => this.onData(String(chunk)))
        this.socket.on('close', () => this.disconnect(new Error('Activation Agent disconnected.')))
        this.socket.on('error', error => this.disconnect(error))
        return
      } catch (cause) {
        lastError = cause instanceof Error ? cause : new Error(String(cause))
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    throw new ActivationClientError({ code: 'agent_unavailable', message: lastError?.message ?? 'Activation Agent did not start.', retryable: true })
  }

  private onData(chunk: string) {
    this.buffer += chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      try {
        const response = activationAgentResponseSchema.parse(JSON.parse(line))
        const request = this.pending.get(response.id)
        if (!request) continue
        clearTimeout(request.timer)
        this.pending.delete(response.id)
        request.resolve(response)
      } catch { /* Invalid Agent output is ignored and the request timeout remains authoritative. */ }
    }
  }

  private disconnect(error: Error) {
    this.socket = undefined
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }

  private request(command: ActivationAgentRequest['command'], input: Partial<Pick<ActivationAgentRequest, 'target' | 'fileId' | 'executable'>> = {}) {
    if (!this.socket) return Promise.reject(new ActivationClientError({ code: 'agent_unavailable', message: 'Activation Agent is not connected.', retryable: true }))
    const id = randomUUID()
    const request: ActivationAgentRequest = { id, token: this.token, command, ...input }
    return new Promise<ActivationAgentResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ActivationClientError({ code: 'agent_timeout', message: `Activation Agent timed out while running ${command}.`, retryable: true }))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket!.write(`${JSON.stringify(request)}\n`)
    }).then(response => {
      if (!response.ok) throw new ActivationClientError(response.error ?? { code: 'agent_unavailable', message: 'Activation Agent rejected the request.', retryable: true })
      return response
    })
  }

  async activate(target: ActivationTarget): Promise<ActivationRecord> {
    const response = await this.request('activate', { target })
    if (!response.record) throw new Error('Activation Agent returned no record.')
    return response.record
  }

  async deactivate(fileId: number): Promise<ActivationRecord> {
    const response = await this.request('deactivate', { fileId })
    if (!response.record) throw new Error('Activation Agent returned no record.')
    return response.record
  }

  async launchIsolated(target: ActivationTarget, executable: string): Promise<ActivationRecord> {
    const response = await this.request('launchIsolated', { target, executable })
    if (!response.record) throw new Error('Activation Agent returned no record.')
    return response.record
  }

  async list(): Promise<ActivationRecord[]> {
    return (await this.request('list')).records ?? []
  }

  async deactivateAll(): Promise<ActivationRecord[]> {
    return (await this.request('deactivateAll')).records ?? []
  }

  async stop() {
    if (!this.socket) return
    try { await this.request('shutdown') } finally {
      this.socket?.destroy()
      this.socket = undefined
    }
  }
}
