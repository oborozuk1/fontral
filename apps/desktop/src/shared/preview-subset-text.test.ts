import { describe, expect, it } from 'vitest'
import {
  mergePreviewGlyphText,
  normalizePreviewText,
  normalizeRequestedPreviewText,
  PREVIEW_LATIN_BASE,
  subsetCoversPreview,
} from './preview-subset-text'

describe('preview-subset-text', () => {
  it('always includes printable ASCII Latin base', () => {
    const text = normalizePreviewText('你好')
    for (const character of PREVIEW_LATIN_BASE) {
      expect(text.includes(character), `missing ${JSON.stringify(character)}`).toBe(true)
    }
    expect(text).toContain('你')
    expect(text).toContain('好')
  })

  it('dedupes request glyphs before merging Latin', () => {
    expect(normalizeRequestedPreviewText('aaab')).toBe('ab')
    expect(normalizePreviewText('AAa')).toBe(mergePreviewGlyphText('Aa', PREVIEW_LATIN_BASE))
  })

  it('subsetCoversPreview checks needed glyphs only', () => {
    const baked = normalizePreviewText('字')
    expect(subsetCoversPreview(baked, '字')).toBe(true)
    expect(subsetCoversPreview(baked, 'A')).toBe(true)
    expect(subsetCoversPreview(baked, '字词')).toBe(false)
  })
})
