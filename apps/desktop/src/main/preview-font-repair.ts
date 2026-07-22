import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

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

function tableRecord(bytes: Buffer, tag: string) {
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

export function repairZeroLengthVariationCmap(source: Buffer) {
  const bytes = Buffer.from(source)
  const cmap = tableRecord(bytes, 'cmap')
  const head = tableRecord(bytes, 'head')
  if (!cmap || !head || head.length < 12 || cmap.length < 4) return null

  const numSubtables = bytes.readUInt16BE(cmap.offset + 2)
  if (4 + numSubtables * 8 > cmap.length) return null
  const keptRecords: Buffer[] = []
  const removedOffsets = new Set<number>()
  let maxValidEnd = 4 + numSubtables * 8

  for (let i = 0; i < numSubtables; i += 1) {
    const recordOffset = cmap.offset + 4 + i * 8
    const relativeOffset = bytes.readUInt32BE(recordOffset + 4)
    const subtableOffset = cmap.offset + relativeOffset
    if (relativeOffset + 4 > cmap.length) return null
    const format = bytes.readUInt16BE(subtableOffset)
    if (format === 14 && relativeOffset + 10 <= cmap.length
      && bytes.readUInt32BE(subtableOffset + 2) === 0
      && bytes.readUInt32BE(subtableOffset + 6) === 0) {
      removedOffsets.add(relativeOffset)
      continue
    }

    const length = format === 14
      ? relativeOffset + 6 <= cmap.length ? bytes.readUInt32BE(subtableOffset + 2) : 0
      : format >= 8
        ? relativeOffset + 8 <= cmap.length ? bytes.readUInt32BE(subtableOffset + 4) : 0
        : bytes.readUInt16BE(subtableOffset + 2)
    if (!length || relativeOffset + length > cmap.length) return null
    maxValidEnd = Math.max(maxValidEnd, relativeOffset + length)
    keptRecords.push(Buffer.from(bytes.subarray(recordOffset, recordOffset + 8)))
  }

  if (!removedOffsets.size || !keptRecords.length) return null
  if ([...removedOffsets].some(offset => offset < maxValidEnd)) return null

  bytes.writeUInt16BE(keptRecords.length, cmap.offset + 2)
  bytes.fill(0, cmap.offset + 4, cmap.offset + 4 + numSubtables * 8)
  keptRecords.forEach((record, index) => record.copy(bytes, cmap.offset + 4 + index * 8))
  bytes.writeUInt32BE(maxValidEnd, cmap.recordOffset + 12)

  bytes.writeUInt32BE(tableChecksum(bytes, cmap.offset, maxValidEnd), cmap.recordOffset + 4)
  bytes.writeUInt32BE(0, head.offset + 8)
  bytes.writeUInt32BE(tableChecksum(bytes, head.offset, head.length), head.recordOffset + 4)
  bytes.writeUInt32BE((SFNT_CHECKSUM_MAGIC - tableChecksum(bytes, 0, bytes.length)) >>> 0, head.offset + 8)
  return bytes
}

export async function needsZeroLengthVariationCmapRepair(path: string) {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(12)
    if ((await handle.read(header, 0, header.length, 0)).bytesRead !== header.length) return false
    const numTables = header.readUInt16BE(4)
    if (numTables < 1 || numTables > 4096) return false
    const directory = Buffer.alloc(numTables * 16)
    if ((await handle.read(directory, 0, directory.length, 12)).bytesRead !== directory.length) return false

    let cmapOffset = 0
    let cmapLength = 0
    for (let i = 0; i < numTables; i += 1) {
      const offset = i * 16
      if (directory.toString('ascii', offset, offset + 4) !== 'cmap') continue
      cmapOffset = directory.readUInt32BE(offset + 8)
      cmapLength = directory.readUInt32BE(offset + 12)
      break
    }
    if (!cmapOffset || cmapLength < 4) return false

    const cmapHeader = Buffer.alloc(4)
    if ((await handle.read(cmapHeader, 0, 4, cmapOffset)).bytesRead !== 4) return false
    const numSubtables = cmapHeader.readUInt16BE(2)
    if (4 + numSubtables * 8 > cmapLength) return false
    const records = Buffer.alloc(numSubtables * 8)
    if ((await handle.read(records, 0, records.length, cmapOffset + 4)).bytesRead !== records.length) return false

    const checked = new Set<number>()
    for (let i = 0; i < numSubtables; i += 1) {
      const relativeOffset = records.readUInt32BE(i * 8 + 4)
      if (checked.has(relativeOffset) || relativeOffset + 10 > cmapLength) continue
      checked.add(relativeOffset)
      const subtable = Buffer.alloc(10)
      if ((await handle.read(subtable, 0, 10, cmapOffset + relativeOffset)).bytesRead !== 10) continue
      if (subtable.readUInt16BE(0) === 14 && subtable.readUInt32BE(2) === 0 && subtable.readUInt32BE(6) === 0) return true
    }
    return false
  } finally {
    await handle.close()
  }
}

export async function createRepairedPreviewFont(sourcePath: string, cachePath: string) {
  try {
    if ((await stat(cachePath)).isFile()) return cachePath
  } catch { /* cache miss */ }

  const repaired = repairZeroLengthVariationCmap(await readFile(sourcePath))
  if (!repaired) return sourcePath
  await mkdir(dirname(cachePath), { recursive: true })
  const temporaryPath = `${cachePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, repaired)
  await rename(temporaryPath, cachePath)
  return cachePath
}
