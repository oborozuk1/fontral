import { Worker } from 'node:worker_threads'

export { inferFontLanguage, type FontLanguageHints, type InferredLanguage } from './infer-language'

export type ScanFingerprintMap = Record<string, { size: number; mtimeMs: number }>

export function scanRoot(rootId: number, path: string, workerFile: string, onDone: () => void, onError: (error: Error) => void, options?: { pathPrefix?: string; fingerprints?: ScanFingerprintMap }) {
  const worker = new Worker(workerFile, { workerData: { rootId, path, pathPrefix: options?.pathPrefix, fingerprints: options?.fingerprints }, execArgv: process.execArgv })
  let settled = false
  let terminated = false
  const fail = (error: Error) => { if (!settled) { settled = true; onError(error) } }
  const originalTerminate = worker.terminate.bind(worker)
  worker.terminate = async () => {
    terminated = true
    return originalTerminate()
  }
  worker.once('error', fail)
  worker.on('message', message => { if (message.type === 'done' && !settled) { settled = true; onDone() } })
  worker.once('exit', code => {
    if (settled || terminated) return
    fail(new Error(`Font scanner stopped with code ${code}`))
  })
  return worker
}
