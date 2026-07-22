import { parentPort } from 'node:worker_threads'
import subsetFont from 'subset-font'

export type SubsetWorkerRequest = {
  id: number
  /** SFNT face bytes (single face, not TTC). */
  face: Uint8Array
  text: string
}

export type SubsetWorkerResponse =
  | { id: number; ok: true; fullFace: false; body: Uint8Array }
  | { id: number; ok: true; fullFace: true }
  | { id: number; ok: false; error: string }

async function subsetWithFallback(face: Buffer, text: string): Promise<{ body: Buffer; fullFace: boolean }> {
  const subsetText = text.length ? text : ' '
  const attempts: Array<() => Promise<Buffer>> = [
    async () => Buffer.from(await subsetFont(face, subsetText, {
      targetFormat: 'sfnt',
      noLayoutClosure: true,
    })),
    async () => Buffer.from(await subsetFont(face, subsetText, {
      targetFormat: 'sfnt',
      noLayoutClosure: false,
    })),
  ]

  if (subsetText.trim()) {
    attempts.push(async () => Buffer.from(await subsetFont(face, 'A.', {
      targetFormat: 'sfnt',
      noLayoutClosure: true,
    })))
  }

  for (const attempt of attempts) {
    try {
      const body = await attempt()
      if (body.byteLength > 0) return { body, fullFace: false }
    } catch {
      /* try next strategy */
    }
  }

  return { body: face, fullFace: true }
}

function post(message: SubsetWorkerResponse, transfer?: ArrayBuffer[]) {
  if (transfer?.length) parentPort?.postMessage(message, transfer)
  else parentPort?.postMessage(message)
}

parentPort?.on('message', (message: SubsetWorkerRequest) => {
  void (async () => {
    const id = message?.id
    if (!Number.isFinite(id)) return
    try {
      const source = message.face
      if (!source?.byteLength) {
        post({ id, ok: false, error: 'Empty face buffer' })
        return
      }
      const face = Buffer.from(source.buffer, source.byteOffset, source.byteLength)
      const text = typeof message.text === 'string' ? message.text : ' '
      const result = await subsetWithFallback(face, text)
      if (result.fullFace) {
        post({ id, ok: true, fullFace: true })
        return
      }
      const body = new Uint8Array(result.body.byteLength)
      body.set(result.body)
      post({ id, ok: true, fullFace: false, body }, [body.buffer])
    } catch (error) {
      post({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})
