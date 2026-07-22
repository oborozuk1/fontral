import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { FontDatabase } from './index'

const files: string[] = []
afterEach(() => { for (const file of files.splice(0)) rmSync(file, { force: true }) })

describe('database initialization', () => {
  it('preserves indexed and user data across repeated initialization', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    let database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({
      rootId,
      path: 'C:\\Fonts\\Example.ttf',
      normalizedPath: 'c:\\fonts\\example.ttf',
      size: 100,
      mtimeMs: 1,
      sha256: 'a'.repeat(64),
      format: 'ttf',
      faces: [{
        faceIndex: 0,
        family: 'Example',
        postscriptName: 'Example-Regular',
        isVariable: false,
        cmapRanges: Buffer.from(Uint32Array.of(0x41, 0x5a).buffer),
      }],
    })
    const face = database.query({ text: '', limit: 10 }).items[0]!
    expect(database.query({ text: '', limit: 10 }).total).toBe(1)
    database.updateUserData({ faceId: face.id, favorite: true, note: 'keep me' })
    expect(database.cmapRanges(face.id)?.equals(Buffer.from(Uint32Array.of(0x41, 0x5a).buffer))).toBe(true)
    expect(database.listFingerprints(rootId)).toHaveLength(1)
    database.close()

    database = new FontDatabase(file)
    const restored = database.query({ text: '', limit: 10, favorite: true }).items[0]!
    expect(restored.family).toBe('Example')
    expect(database.faceDetails(restored.id)?.note).toBe('keep me')
    expect(database.cmapRanges(restored.id)?.byteLength).toBe(8)
    expect(existsSync(file)).toBe(true)
    database.close()
  })

  it('treats faces without cmap ranges as needing rescan', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({
      rootId,
      path: 'C:\\Fonts\\Legacy.ttf',
      normalizedPath: 'c:\\fonts\\legacy.ttf',
      size: 100,
      mtimeMs: 1,
      sha256: 'c'.repeat(64),
      format: 'ttf',
      faces: [{ faceIndex: 0, family: 'Legacy', isVariable: false }],
    })
    expect(database.listFingerprints(rootId)).toHaveLength(0)
    database.close()
  })

  it('returns one face per family and prefers Regular', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\Fonts')
    database.upsertFile({ rootId, path: 'C:\Fonts\Display.ttc', normalizedPath: 'c:\fonts\display.ttc', size: 100, mtimeMs: 1, sha256: 'd'.repeat(64), format: 'ttc', faces: [
      { faceIndex: 0, family: 'Display', subfamily: 'Bold', weight: 700, isVariable: false },
      { faceIndex: 1, family: 'Display', subfamily: 'Regular', weight: 400, isVariable: false },
      { faceIndex: 2, family: 'Display', subfamily: 'Light', weight: 300, isVariable: false },
      { faceIndex: 3, family: 'Single Weight', subfamily: 'Bold', weight: 700, isVariable: false },
    ] })

    const page = database.query({ text: '', limit: 10, groupByFamily: true })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(2)
    expect(page.items.find(face => face.family === 'Display')?.subfamily).toBe('Regular')
    expect(page.items.find(face => face.family === 'Single Weight')?.subfamily).toBe('Bold')
    database.close()
  })

  it('finds similar families through each family Regular face', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Similar.ttc', normalizedPath: 'c:\\fonts\\similar.ttc', size: 100, mtimeMs: 1, sha256: '1'.repeat(64), format: 'ttc', faces: [
      { faceIndex: 0, family: 'Source', subfamily: 'Bold', weight: 700, isVariable: false },
      { faceIndex: 1, family: 'Source', subfamily: 'Regular', weight: 400, isVariable: false },
      { faceIndex: 2, family: 'Close', subfamily: 'Regular', weight: 400, isVariable: false },
      { faceIndex: 3, family: 'Far', subfamily: 'Regular', weight: 400, isVariable: false },
    ] })
    const faces = database.query({ text: '', limit: 10 }).items
    const sourceBold = faces.find(face => face.family === 'Source' && face.subfamily === 'Bold')!
    const sourceRegular = faces.find(face => face.family === 'Source' && face.subfamily === 'Regular')!
    // Build v3 signatures: a single rendered character whose 20x20 cell grid is filled with a constant value.
    const makeSig = (fill: number) => ({ v: 3 as const, valid: [1], aspects: [0.5], cells: Array<number>(400).fill(fill) })
    database.saveSimilaritySignature(sourceRegular.id, makeSig(0.5))
    database.saveSimilaritySignature(faces.find(face => face.family === 'Close')!.id, makeSig(0.51))
    database.saveSimilaritySignature(faces.find(face => face.family === 'Far')!.id, makeSig(1))

    const results = database.similar(sourceBold.id)
    expect(results.map(face => face.family)).toEqual(['Close', 'Far'])
    expect(results[0]?.similarity).toBeGreaterThan(results[1]?.similarity ?? 0)
    database.close()
  })

  it('penalizes glyphs the source has but the candidate lacks', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Mixed.ttf', normalizedPath: 'c:\\fonts\\mixed.ttf', size: 100, mtimeMs: 1, sha256: '2'.repeat(64), format: 'ttf', faces: [
      { faceIndex: 0, family: 'Latin Only', subfamily: 'Regular', weight: 400, isVariable: false },
      { faceIndex: 1, family: 'Cjk Pal', subfamily: 'Regular', weight: 400, isVariable: false },
    ] })
    const faces = database.query({ text: '', limit: 10 }).items
    const latin = faces.find(face => face.family === 'Latin Only')!
    const cjk = faces.find(face => face.family === 'Cjk Pal')!
    // Two characters: Latin glyph present in both, CJK glyph present only in the source (cjk family).
    // The Latin outlines are identical, so a "skip missing" rule would score 100%.
    const latinCells = Array<number>(400).fill(0.5)
    const cjkCells = Array<number>(400).fill(0.7)
    const latinSig = { v: 3 as const, valid: [1, 0], aspects: [0.5, 0], cells: [...latinCells, ...Array<number>(400).fill(0)] }
    const cjkSig = { v: 3 as const, valid: [1, 1], aspects: [0.5, 0.5], cells: [...latinCells, ...cjkCells] }
    database.saveSimilaritySignature(latin.id, latinSig)
    database.saveSimilaritySignature(cjk.id, cjkSig)

    const results = database.similar(cjk.id)
    // Source has both chars but candidate only renders one → the missing CJK glyph counts as 0.
    expect(results).toHaveLength(1)
    expect(results[0]?.family).toBe('Latin Only')
    expect(results[0]?.similarity).toBe(50)
    database.close()
  })

  it('compares selected faces when face similarity mode is requested', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Faces.ttc', normalizedPath: 'c:\\fonts\\faces.ttc', size: 100, mtimeMs: 1, sha256: '3'.repeat(64), format: 'ttc', faces: [
      { faceIndex: 0, family: 'Source', subfamily: 'Bold', weight: 700, isVariable: false },
      { faceIndex: 1, family: 'Source', subfamily: 'Regular', weight: 400, isVariable: false },
      { faceIndex: 2, family: 'Target', subfamily: 'Bold', weight: 700, isVariable: false },
      { faceIndex: 3, family: 'Target', subfamily: 'Regular', weight: 400, isVariable: false },
    ] })
    const faces = database.query({ text: '', limit: 10 }).items
    const sourceBold = faces.find(face => face.family === 'Source' && face.subfamily === 'Bold')!
    const sourceRegular = faces.find(face => face.family === 'Source' && face.subfamily === 'Regular')!
    const targetBold = faces.find(face => face.family === 'Target' && face.subfamily === 'Bold')!
    const targetRegular = faces.find(face => face.family === 'Target' && face.subfamily === 'Regular')!
    const makeSig = (fill: number) => ({ v: 3 as const, valid: [1], aspects: [0.5], cells: Array<number>(400).fill(fill) })
    database.saveSimilaritySignature(sourceBold.id, makeSig(0.8))
    database.saveSimilaritySignature(sourceRegular.id, makeSig(0.5))
    database.saveSimilaritySignature(targetBold.id, makeSig(0.8))
    database.saveSimilaritySignature(targetRegular.id, makeSig(1))

    // Family mode ignores the Bold signatures and compares the Regular representatives.
    expect(database.similar(sourceBold.id, 'family')[0]?.subfamily).toBe('Regular')
    // Face mode compares Source Bold against both Target faces, selecting Target Bold first.
    const byFace = database.similar(sourceBold.id, 'face')
    expect(byFace[0]?.id).toBe(targetBold.id)
    expect(byFace[0]?.similarity).toBe(100)
    database.close()
  })

  it('filters faces by a weight range', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Weights.ttc', normalizedPath: 'c:\\fonts\\weights.ttc', size: 100, mtimeMs: 1, sha256: 'e'.repeat(64), format: 'ttc', faces: [
      { faceIndex: 0, family: 'Weight 400', weight: 400, isVariable: false },
      { faceIndex: 1, family: 'Weight 700', weight: 700, isVariable: false },
    ] })

    expect(database.query({ text: '', limit: 10, weightMin: 700, weightMax: 900 }).items.map(face => face.family)).toEqual(['Weight 700'])
    expect(database.query({ text: '', limit: 10, weightMin: 100, weightMax: 500 }).items.map(face => face.family)).toEqual(['Weight 400'])
    expect(database.query({ text: '', limit: 10, weightMin: 100, weightMax: 900 }).items.map(face => face.family)).toEqual(['Weight 400', 'Weight 700'])
    database.close()
  })

  it('hides fonts in a hidden subdirectory and keeps sibling directories visible', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Hidden\\Nested\\Hidden.ttf', normalizedPath: 'c:\\fonts\\hidden\\nested\\hidden.ttf', size: 100, mtimeMs: 1, sha256: 'e'.repeat(64), format: 'ttf', faces: [{ faceIndex: 0, family: 'Hidden', isVariable: false }] })
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Shown\\Shown.ttf', normalizedPath: 'c:\\fonts\\shown\\shown.ttf', size: 100, mtimeMs: 1, sha256: 'f'.repeat(64), format: 'ttf', faces: [{ faceIndex: 0, family: 'Shown', isVariable: false }] })

    database.setFolderVisible(rootId, 'C:\\Fonts\\Hidden', false)

    expect(database.query({ text: '', limit: 10 }).items.map(face => face.family)).toEqual(['Shown'])
    expect(database.family('Hidden')).toEqual([])
    const hidden = database.rootTrees()[0]!.children.find(node => node.name === 'Hidden')
    expect(hidden?.visible).toBe(0)
    expect(hidden?.children[0]?.visible).toBe(1)
    database.close()
  })

  it('persists activation records by physical font file', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Collection.ttc', normalizedPath: 'c:\\fonts\\collection.ttc', size: 100, mtimeMs: 1, sha256: 'b'.repeat(64), format: 'ttc', faces: [
      { faceIndex: 0, family: 'Collection A', postscriptName: 'Collection-A', isVariable: false },
      { faceIndex: 1, family: 'Collection B', postscriptName: 'Collection-B', isVariable: false },
    ] })
    const faces = database.query({ text: '', limit: 10 }).items
    expect(database.query({ text: '', limit: 10 }).total).toBe(2)
    const sessionId = randomUUID()
    database.createActivationSession({ id: sessionId, agentPid: 2, mainPid: 1, platform: 'test' })
    const target = database.resolveActivationTarget(faces[0]!.id, sessionId)!
    database.saveActivationRecord({ sessionId, faceId: faces[0]!.id, fileId: target.fileId, faceIds: [faces[0]!.id], path: target.path, sha256: target.sha256, status: 'active', ownedRefCount: 1, platformToken: 'fake', error: null, updatedAt: Date.now() }, target)
    const record = database.listActivationRecords(sessionId)[0]!
    expect(record.faceIds).toEqual(faces.map(face => face.id))
    expect(record.ownedRefCount).toBe(1)
    database.close()
  })

  it('links families bidirectionally through any face and resolves representatives', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Alpha.ttc', normalizedPath: 'c:\\fonts\\alpha.ttc', size: 100, mtimeMs: 1, sha256: '1'.repeat(64), format: 'ttc', faces: [
      { faceIndex: 0, family: 'Alpha', subfamily: 'Bold', weight: 700, isVariable: false },
      { faceIndex: 1, family: 'Alpha', subfamily: 'Regular', weight: 400, isVariable: false },
    ] })
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Beta.ttf', normalizedPath: 'c:\\fonts\\beta.ttf', size: 100, mtimeMs: 1, sha256: '2'.repeat(64), format: 'ttf', faces: [
      { faceIndex: 0, family: 'Beta', subfamily: 'Regular', weight: 400, isVariable: false },
    ] })
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Gamma.ttf', normalizedPath: 'c:\\fonts\\gamma.ttf', size: 100, mtimeMs: 1, sha256: '3'.repeat(64), format: 'ttf', faces: [
      { faceIndex: 0, family: 'Gamma', subfamily: 'Regular', weight: 400, isVariable: false },
    ] })
    const faces = database.query({ text: '', limit: 10 }).items
    const alphaBold = faces.find(face => face.family === 'Alpha' && face.subfamily === 'Bold')!
    const alphaRegular = faces.find(face => face.family === 'Alpha' && face.subfamily === 'Regular')!
    const beta = faces.find(face => face.family === 'Beta')!
    const gamma = faces.find(face => face.family === 'Gamma')!

    // Linking through the Bold variant still targets the Regular representative.
    database.addFamilyLink(alphaBold.id, beta.id)
    expect(database.listFamilyLinks(alphaBold.id).map(face => face.family)).toEqual(['Beta'])
    // Listing from the Regular face of the same family yields the same result.
    expect(database.listFamilyLinks(alphaRegular.id).map(face => face.family)).toEqual(['Beta'])
    // Bidirectional: Beta sees Alpha back, resolved to its Regular representative.
    expect(database.listFamilyLinks(beta.id).map(face => face.family)).toEqual(['Alpha'])
    expect(database.listFamilyLinks(beta.id)[0]!.subfamily).toBe('Regular')

    // Adding a second link and removing one keeps the other intact.
    database.addFamilyLink(alphaRegular.id, gamma.id)
    expect(database.listFamilyLinks(alphaBold.id).map(face => face.family)).toEqual(['Beta', 'Gamma'])
    database.removeFamilyLink(alphaBold.id, beta.id)
    expect(database.listFamilyLinks(alphaBold.id).map(face => face.family)).toEqual(['Gamma'])
    // Removal is bidirectional too.
    expect(database.listFamilyLinks(beta.id)).toEqual([])

    // Re-adding an existing link is idempotent.
    database.addFamilyLink(alphaRegular.id, gamma.id)
    database.addFamilyLink(alphaBold.id, gamma.id)
    expect(database.listFamilyLinks(alphaRegular.id).map(face => face.family)).toEqual(['Gamma'])

    // A family cannot be linked to itself.
    expect(() => database.addFamilyLink(alphaBold.id, alphaRegular.id)).toThrow()
    database.close()
  })

  it('treats unquoted tokens as independent AND terms and quoted terms as whitespace-preserving substrings', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Abg.ttf', normalizedPath: 'c:\\fonts\\abg.ttf', size: 100, mtimeMs: 1, sha256: '1'.repeat(64), format: 'ttf', faces: [{ faceIndex: 0, family: 'Alpha Beta Gamma', isVariable: false }] })
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Ag.ttf', normalizedPath: 'c:\\fonts\\ag.ttf', size: 100, mtimeMs: 1, sha256: '2'.repeat(64), format: 'ttf', faces: [{ faceIndex: 0, family: 'Alpha Gamma', isVariable: false }] })
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Song.ttf', normalizedPath: 'c:\\fonts\\song.ttf', size: 100, mtimeMs: 1, sha256: '3'.repeat(64), format: 'ttf', faces: [{ faceIndex: 0, family: '新宋体', isVariable: false }] })

    const families = (text: string) => database.query({ text, limit: 10 }).items.map(face => face.family)
    // Unquoted tokens are independent AND terms.
    expect(families('alpha gamma').sort()).toEqual(['Alpha Beta Gamma', 'Alpha Gamma'])
    // Quotes preserve the contiguous text sequence.
    expect(families('"alpha gamma"')).toEqual(['Alpha Gamma'])
    expect(families('"alpha beta"')).toEqual(['Alpha Beta Gamma'])
    expect(families('"alpha beta gamma"')).toEqual(['Alpha Beta Gamma'])
    // Mixed quoted and loose terms both have to match.
    expect(families('"alpha beta" gamma')).toEqual(['Alpha Beta Gamma'])
    expect(families('"alpha gamma" beta')).toEqual([])
    expect(families('"宋体"')).toEqual(['新宋体'])
    expect(families('"宋 体"')).toEqual([])
    database.close()
  })

  it('ignores empty quotes and punctuation-only search input without breaking the query', () => {
    const file = join(tmpdir(), `fontral-${randomUUID()}.db`)
    files.push(file, `${file}-wal`, `${file}-shm`)
    const database = new FontDatabase(file)
    const rootId = database.addRoot('C:\\Fonts')
    database.upsertFile({ rootId, path: 'C:\\Fonts\\Abg.ttf', normalizedPath: 'c:\\fonts\\abg.ttf', size: 100, mtimeMs: 1, sha256: '1'.repeat(64), format: 'ttf', faces: [{ faceIndex: 0, family: 'Alpha Beta Gamma', isVariable: false }] })

    // Empty quotes act as no text filter.
    expect(database.query({ text: '""', limit: 10 }).items.map(face => face.family)).toEqual(['Alpha Beta Gamma'])
    // Punctuation-only bare token does not throw and matches via the LIKE fallback.
    expect(database.query({ text: '!!!', limit: 10 }).items.map(face => face.family)).toEqual([])
    // Punctuation-only quoted phrase does not throw.
    expect(database.query({ text: '"!!!"', limit: 10 }).items.map(face => face.family)).toEqual([])
    database.close()
  })
})
