/** Printable ASCII (space + 0x21–0x7E) always baked into preview subsets. */
export const PREVIEW_LATIN_BASE =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'

const MAX_REQUEST_GLYPHS = 512

/** Keep printable code points from user/preview text; dedupe; cap size. */
export function normalizeRequestedPreviewText(text: string) {
  const chars = Array.from(text ?? '').filter(character => {
    const code = character.codePointAt(0)
    if (code === undefined) return false
    if (code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20) return true
    return code >= 0x21
  })
  const seen = new Set<string>()
  const unique: string[] = []
  for (const character of chars) {
    if (seen.has(character)) continue
    seen.add(character)
    unique.push(character)
    if (unique.length >= MAX_REQUEST_GLYPHS) break
  }
  return unique.join('')
}

/** Merge strings' unique code points (order preserved). */
export function mergePreviewGlyphText(...parts: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    for (const character of Array.from(part ?? '')) {
      if (seen.has(character)) continue
      seen.add(character)
      out.push(character)
    }
  }
  return out.join('') || ' '
}

/** Requested glyphs + default Latin base (Latin always present even when request is empty). */
export function normalizePreviewText(text: string) {
  const requested = normalizeRequestedPreviewText(text)
  return mergePreviewGlyphText(requested, PREVIEW_LATIN_BASE)
}

export function subsetCoversPreview(subsetText: string, neededText: string) {
  if (!neededText) return true
  const have = new Set(Array.from(subsetText || ''))
  for (const character of Array.from(neededText)) {
    if (!have.has(character)) return false
  }
  return true
}
