import tablesJson from './cjk-tables/tables.json'
import jisLevel1Table from './cjk-tables/jis-lv1.json'
import jisLevel2Table from './cjk-tables/jis-lv2.json'
import ksx1001Table from './cjk-tables/ksx1001.json'

export type InferredLanguage = 'fontLanguage.simplifiedChinese' | 'fontLanguage.traditionalChinese' | 'fontLanguage.simplifiedAndTraditionalChinese' | 'fontLanguage.japanese' | 'fontLanguage.korean' | 'fontLanguage.latin' | 'fontLanguage.other'

type TableDef = {
  id: string
  total: number
  codePoints: number[]
}

export type FontLanguageHints = {
  names?: Iterable<string>
  codePageRange1?: number
}

const tableDefs = (tablesJson as { tables: TableDef[] }).tables
const tableSets = tableDefs
  .map(table => ({
    id: table.id,
    total: table.total,
    set: new Set(table.codePoints),
  }))

const japaneseLevel1Table = { total: jisLevel1Table.codePoints.length, set: new Set(jisLevel1Table.codePoints) }
const japaneseLevel2Table = { total: jisLevel2Table.codePoints.length, set: new Set(jisLevel2Table.codePoints) }
const koreanTable = { total: ksx1001Table.codePoints.length, set: new Set(ksx1001Table.codePoints) }

function tableById(id: string) {
  return tableSets.find(table => table.id === id)
}

function coverage(table: { total: number; set: Set<number> } | undefined, points: Set<number>) {
  if (!table?.total) return 0
  let hit = 0
  for (const point of table.set) if (points.has(point)) hit++
  return hit / table.total
}

function rangeCoverage(start: number, end: number, points: Set<number>) {
  let hit = 0
  for (let point = start; point <= end; point++) if (points.has(point)) hit++
  return hit / (end - start + 1)
}

/** Infer the primary writing system from the cmap coverage of standard base character sets. */
export function inferFontLanguage(characterSet: Iterable<number>, _hints?: FontLanguageHints): InferredLanguage {
  const points = Array.from(characterSet)
  const pointSet = new Set(points)

  let latin = 0

  for (const point of points) {
    if (
      (point >= 0x0041 && point <= 0x005a)
      || (point >= 0x0061 && point <= 0x007a)
      || (point >= 0x00c0 && point <= 0x024f)
      || (point >= 0x1e00 && point <= 0x1eff)
    ) {
      latin++
    }
  }

  const simplified = coverage(tableById('gb2312'), pointSet)
  const traditional = coverage(tableById('big5'), pointSet)
  const japaneseLevel1 = coverage(japaneseLevel1Table, pointSet)
  const japaneseLevel2 = coverage(japaneseLevel2Table, pointSet)
  const korean = coverage(koreanTable, pointSet)
  const strongestCjkCoverage = Math.max(simplified, traditional, korean)
  const hangulSyllables = rangeCoverage(0xac00, 0xd7a3, pointSet)

  // A few incidental CJK glyphs do not establish a writing system.
  if (strongestCjkCoverage >= 0.04 || japaneseLevel1 >= 0.04 || japaneseLevel2 >= 0.04) {
    // KS X 1001 also includes kana, so check its distinctive Hangul syllables first.
    if (korean >= 0.04 && hangulSyllables >= 0.2) return 'fontLanguage.korean'
    // Japanese kanji overlap substantially with Big5. Require both JIS X 0208 levels and
    // materially lower GB2312 coverage instead of using kana, which Chinese fonts often include.
    if (japaneseLevel1 >= 0.75 && japaneseLevel2 >= 0.75 && simplified < 0.75 && traditional < 0.75) return 'fontLanguage.japanese'
    if (simplified >= 0.75 && traditional >= 0.75) return 'fontLanguage.simplifiedAndTraditionalChinese'
    if (Math.max(simplified, traditional) >= 0.04) return simplified >= traditional ? 'fontLanguage.simplifiedChinese' : 'fontLanguage.traditionalChinese'
  }
  if (latin >= 52) return 'fontLanguage.latin'
  return 'fontLanguage.other'
}
