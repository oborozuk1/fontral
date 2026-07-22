/** Compact cmap range storage and preview-text coverage checks. */

const MISSING_GLYPH = '\uFDD0'

export function encodeCmapRanges(codePoints: Iterable<number>): Buffer {
  const unique = [...new Set(
    [...codePoints].filter(point => Number.isInteger(point) && point >= 0 && point <= 0x10ffff),
  )].sort((a, b) => a - b)
  if (!unique.length) return Buffer.alloc(0)

  const ranges: number[] = []
  let start = unique[0]!
  let end = start
  for (let i = 1; i < unique.length; i += 1) {
    const point = unique[i]!
    if (point === end + 1) {
      end = point
      continue
    }
    ranges.push(start, end)
    start = point
    end = point
  }
  ranges.push(start, end)

  const bytes = Buffer.allocUnsafe(ranges.length * 4)
  for (let i = 0; i < ranges.length; i += 1) bytes.writeUInt32LE(ranges[i]!, i * 4)
  return bytes
}

export function decodeCmapRanges(bytes: Buffer | Uint8Array | null | undefined): Array<[number, number]> {
  if (!bytes || bytes.length < 8 || bytes.length % 8 !== 0) return []
  const view = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  const ranges: Array<[number, number]> = []
  for (let offset = 0; offset < view.length; offset += 8) {
    const start = view.readUInt32LE(offset)
    const end = view.readUInt32LE(offset + 4)
    if (start > end || end > 0x10ffff) continue
    ranges.push([start, end])
  }
  return ranges
}

export function hasCodePoint(ranges: Array<[number, number]>, codePoint: number) {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const range = ranges[mid]!
    if (codePoint < range[0]) hi = mid - 1
    else if (codePoint > range[1]) lo = mid + 1
    else return true
  }
  return false
}

export function mapPreviewText(rangesBytes: Buffer | Uint8Array | null | undefined, text: string) {
  const ranges = decodeCmapRanges(rangesBytes)
  if (!ranges.length) {
    return { text, covers: true, fromIndex: false as const }
  }
  let covers = true
  const mapped = Array.from(text, character => {
    const code = character.codePointAt(0)
    if (code === undefined) return character
    if (hasCodePoint(ranges, code)) return character
    covers = false
    return MISSING_GLYPH
  }).join('')
  return { text: mapped, covers, fromIndex: true as const }
}

export { MISSING_GLYPH }
