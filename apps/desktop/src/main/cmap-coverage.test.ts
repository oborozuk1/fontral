import { describe, expect, it } from 'vitest'
import { encodeCmapRanges, hasCodePoint, mapPreviewText, MISSING_GLYPH } from './cmap-coverage'

describe('cmap coverage', () => {
  it('encodes contiguous ranges compactly', () => {
    // 65-67, 90, 0x4E00, 0x4E02 => 4 ranges
    const bytes = encodeCmapRanges([65, 66, 67, 90, 0x4e00, 0x4e02])
    expect(bytes.length).toBe(4 * 2 * 4)
    expect(hasCodePoint([[65, 67], [90, 90], [0x4e00, 0x4e00], [0x4e02, 0x4e02]], 66)).toBe(true)
    expect(hasCodePoint([[65, 67], [90, 90]], 68)).toBe(false)
  })

  it('maps missing preview glyphs to the sentinel', () => {
    // 永 = U+6C38
    const bytes = encodeCmapRanges([0x41, 0x42, 0x6c38])
    const mapped = mapPreviewText(bytes, 'AB永X')
    expect(mapped.covers).toBe(false)
    expect(mapped.text).toBe(`AB永${MISSING_GLYPH}`)
    expect(mapPreviewText(bytes, 'AB永').covers).toBe(true)
  })
})
