import { describe, expect, it } from 'vitest'
import { repairZeroLengthVariationCmap } from './preview-font-repair'

function fixture(format14Length: number, numVarSelectorRecords = 0) {
  const bytes = Buffer.alloc(176)
  bytes.writeUInt32BE(0x00010000, 0)
  bytes.writeUInt16BE(2, 4)

  bytes.write('cmap', 12, 'ascii')
  bytes.writeUInt32BE(64, 20)
  bytes.writeUInt32BE(46, 24)
  bytes.write('head', 28, 'ascii')
  bytes.writeUInt32BE(88, 36)
  bytes.writeUInt32BE(54, 40)

  bytes.writeUInt16BE(0, 64)
  bytes.writeUInt16BE(2, 66)
  bytes.writeUInt16BE(0, 68)
  bytes.writeUInt16BE(3, 70)
  bytes.writeUInt32BE(20, 72)
  bytes.writeUInt16BE(0, 76)
  bytes.writeUInt16BE(5, 78)
  bytes.writeUInt32BE(36, 80)
  bytes.writeUInt16BE(4, 84)
  bytes.writeUInt16BE(16, 86)
  bytes.writeUInt16BE(14, 100)
  bytes.writeUInt32BE(format14Length, 102)
  bytes.writeUInt32BE(numVarSelectorRecords, 106)
  return bytes
}

describe('repairZeroLengthVariationCmap', () => {
  it('repairs an empty format 14 subtable and updates checksums', () => {
    const repaired = repairZeroLengthVariationCmap(fixture(0))
    expect(repaired).not.toBeNull()
    expect(repaired!.readUInt16BE(66)).toBe(1)
    expect(repaired!.readUInt32BE(24)).toBe(36)
    expect(repaired!.readUInt32BE(16)).not.toBe(0)
    expect(repaired!.readUInt32BE(96)).not.toBe(0)
  })

  it('does not alter valid or non-empty variation subtables', () => {
    expect(repairZeroLengthVariationCmap(fixture(10))).toBeNull()
    expect(repairZeroLengthVariationCmap(fixture(0, 1))).toBeNull()
  })
})
