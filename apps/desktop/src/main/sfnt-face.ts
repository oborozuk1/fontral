/** Extract a single SFNT face from a TTF/OTF or TTC/OTC buffer without full fontkit parse. */

const SFNT_CHECKSUM_MAGIC = 0xB1B0AFBA

function tableChecksum(bytes: Buffer, offset: number, length: number) {
  let sum = 0
  for (let i = 0; i < length; i += 4) {
    let word = 0
    for (let j = 0; j < 4; j += 1) word = (word << 8) | (bytes[offset + i + j] ?? 0)
    sum = (sum + (word >>> 0)) >>> 0
  }
  return sum
}

function findTable(bytes: Buffer, tag: string) {
  if (bytes.length < 12) return null
  const numTables = bytes.readUInt16BE(4)
  if (12 + numTables * 16 > bytes.length) return null
  for (let i = 0; i < numTables; i += 1) {
    const recordOffset = 12 + i * 16
    if (bytes.toString('ascii', recordOffset, recordOffset + 4) !== tag) continue
    const offset = bytes.readUInt32BE(recordOffset + 8)
    const length = bytes.readUInt32BE(recordOffset + 12)
    if (offset + length > bytes.length) return null
    return { recordOffset, offset, length }
  }
  return null
}

function finalizeSfntChecksums(bytes: Buffer) {
  const head = findTable(bytes, 'head')
  if (!head || head.length < 12) return bytes
  // Zero adjustment before computing the whole-font checksum.
  bytes.writeUInt32BE(0, head.offset + 8)
  bytes.writeUInt32BE(tableChecksum(bytes, head.offset, head.length), head.recordOffset + 4)
  bytes.writeUInt32BE((SFNT_CHECKSUM_MAGIC - tableChecksum(bytes, 0, bytes.length)) >>> 0, head.offset + 8)
  return bytes
}

export function extractSfntFace(source: Buffer, faceIndex = 0): Buffer {
  if (source.length < 12) throw new Error('字体文件过小。')
  const signature = source.toString('ascii', 0, 4)
  if (signature !== 'ttcf') {
    if (faceIndex !== 0) throw new Error('字体 face 索引无效。')
    // Already a single SFNT face (ttf/otf).
    return source
  }

  const numFonts = source.readUInt32BE(8)
  if (!Number.isFinite(numFonts) || numFonts < 1 || faceIndex < 0 || faceIndex >= numFonts) {
    throw new Error('字体 face 索引无效。')
  }
  const headerSize = 12 + numFonts * 4
  if (headerSize > source.length) throw new Error('字体集合头损坏。')
  const faceOffset = source.readUInt32BE(12 + faceIndex * 4)
  if (faceOffset + 12 > source.length) throw new Error('字体 face 偏移无效。')

  const numTables = source.readUInt16BE(faceOffset + 4)
  if (!Number.isFinite(numTables) || numTables < 1 || numTables > 4096) throw new Error('字体表数量无效。')
  if (faceOffset + 12 + numTables * 16 > source.length) throw new Error('字体表目录损坏。')

  const tables: Array<{ tag: string; offset: number; length: number; data: Buffer }> = []
  for (let i = 0; i < numTables; i += 1) {
    const record = faceOffset + 12 + i * 16
    const tag = source.toString('ascii', record, record + 4)
    const offset = source.readUInt32BE(record + 8)
    const length = source.readUInt32BE(record + 12)
    if (!tag || offset + length > source.length || length < 0) throw new Error(`字体表 ${tag || i} 损坏。`)
    tables.push({ tag, offset, length, data: Buffer.from(source.subarray(offset, offset + length)) })
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))

  const searchRange = 2 ** Math.floor(Math.log2(tables.length)) * 16
  const entrySelector = Math.floor(Math.log2(tables.length))
  const rangeShift = tables.length * 16 - searchRange
  let dataOffset = 12 + tables.length * 16
  const placed: Array<{ tag: string; data: Buffer; offset: number; pad: number }> = []
  for (const table of tables) {
    const pad = (4 - (table.data.length % 4)) % 4
    placed.push({ tag: table.tag, data: table.data, offset: dataOffset, pad })
    dataOffset += table.data.length + pad
  }

  const out = Buffer.alloc(dataOffset)
  source.copy(out, 0, faceOffset, faceOffset + 4)
  out.writeUInt16BE(tables.length, 4)
  out.writeUInt16BE(searchRange, 6)
  out.writeUInt16BE(entrySelector, 8)
  out.writeUInt16BE(rangeShift, 10)

  let recordOffset = 12
  for (const table of placed) {
    out.write(table.tag.padEnd(4, ' ').slice(0, 4), recordOffset, 4, 'ascii')
    out.writeUInt32BE(tableChecksum(table.data, 0, table.data.length), recordOffset + 4)
    out.writeUInt32BE(table.offset, recordOffset + 8)
    out.writeUInt32BE(table.data.length, recordOffset + 12)
    table.data.copy(out, table.offset)
    recordOffset += 16
  }
  return finalizeSfntChecksums(out)
}
