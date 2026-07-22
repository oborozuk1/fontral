import { describe, expect, it } from 'vitest'
import { extractSfntFace } from './sfnt-face'

function writeTable(tag: string, payload: Buffer) {
  return { tag, payload }
}

function buildSfnt(tables: Array<{ tag: string; payload: Buffer }>, scaler = Buffer.from([0, 1, 0, 0])) {
  const sorted = [...tables].sort((a, b) => a.tag.localeCompare(b.tag))
  const numTables = sorted.length
  const searchRange = 2 ** Math.floor(Math.log2(numTables)) * 16
  const entrySelector = Math.floor(Math.log2(numTables))
  const rangeShift = numTables * 16 - searchRange
  let offset = 12 + numTables * 16
  const placed = sorted.map(table => {
    const pad = (4 - (table.payload.length % 4)) % 4
    const item = { ...table, offset, pad }
    offset += table.payload.length + pad
    return item
  })
  const out = Buffer.alloc(offset)
  scaler.copy(out, 0)
  out.writeUInt16BE(numTables, 4)
  out.writeUInt16BE(searchRange, 6)
  out.writeUInt16BE(entrySelector, 8)
  out.writeUInt16BE(rangeShift, 10)
  let record = 12
  for (const table of placed) {
    out.write(table.tag.padEnd(4, ' ').slice(0, 4), record, 4, 'ascii')
    out.writeUInt32BE(0, record + 4)
    out.writeUInt32BE(table.offset, record + 8)
    out.writeUInt32BE(table.payload.length, record + 12)
    table.payload.copy(out, table.offset)
    record += 16
  }
  return out
}

function buildTtc(faces: Buffer[]) {
  const headerSize = 12 + faces.length * 4
  let offset = headerSize
  const offsets: number[] = []
  for (const face of faces) {
    offsets.push(offset)
    offset += face.length
  }
  const out = Buffer.alloc(offset)
  out.write('ttcf', 0, 4, 'ascii')
  out.writeUInt32BE(0x00010000, 4)
  out.writeUInt32BE(faces.length, 8)
  offsets.forEach((value, index) => out.writeUInt32BE(value, 12 + index * 4))
  faces.forEach((face, index) => face.copy(out, offsets[index]!))
  // Fix absolute table offsets inside each embedded face directory.
  faces.forEach((face, index) => {
    const faceOffset = offsets[index]!
    const numTables = face.readUInt16BE(4)
    for (let i = 0; i < numTables; i += 1) {
      const record = faceOffset + 12 + i * 16
      const relative = out.readUInt32BE(record + 8)
      out.writeUInt32BE(faceOffset + relative, record + 8)
    }
  })
  return out
}

describe('extractSfntFace', () => {
  it('returns single-font buffers unchanged', () => {
    const sfnt = buildSfnt([
      writeTable('head', Buffer.alloc(54, 1)),
      writeTable('cmap', Buffer.from([0, 0, 0, 1])),
    ])
    const out = extractSfntFace(sfnt, 0)
    expect(out.equals(sfnt)).toBe(true)
  })

  it('extracts a face from a TTC', () => {
    const face0 = buildSfnt([
      writeTable('head', Buffer.alloc(54, 1)),
      writeTable('cmap', Buffer.from([0, 0, 0, 1, 2, 3])),
    ])
    const face1 = buildSfnt([
      writeTable('head', Buffer.alloc(54, 9)),
      writeTable('cmap', Buffer.from([9, 8, 7, 6])),
    ])
    const ttc = buildTtc([face0, face1])
    const extracted = extractSfntFace(ttc, 1)
    expect(extracted.readUInt16BE(4)).toBe(2)
    // head payload marker from face1
    const headRecordOffset = 12
    const headDataOffset = extracted.readUInt32BE(headRecordOffset + 8)
    expect(extracted[headDataOffset]).toBe(9)
  })
})
