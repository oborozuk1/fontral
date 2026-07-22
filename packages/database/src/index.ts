import Database from 'better-sqlite3'
import type { ActivationError, ActivationRecord, ActivationStatus, ActivationTarget, FontFaceDetail, FontFaceSummary, FontPage, FolderFilter, LibraryFolderNode, LibraryRootTree, SimilarFontFamily, SimilarityMode } from '@fontral/contracts'
import { FONT_LANGUAGES } from '@fontral/contracts'

const SIMILARITY_VERSION = 3

type SimSignature = { v: number; valid: number[]; aspects: number[]; cells: number[] }

function parseSignature(json: string): SimSignature | null {
  try {
    const obj = JSON.parse(json)
    if (!obj || obj.v !== 3 || !Array.isArray(obj.valid) || !Array.isArray(obj.cells)) return null
    return obj as SimSignature
  } catch {
    return null
  }
}

// Per-character fuzzy IoU averaged across characters the source font renders.
// The source drives the denominator: if the source has a glyph the candidate lacks,
// that character scores 0 (penalized) — so a CJK source will push Latin-only candidates
// far down even when their Latin outlines match perfectly. Characters the source itself
// lacks are skipped entirely, so a Latin source is never rewarded or punished by CJK coverage.
function iouScore(origin: SimSignature, candidate: SimSignature): number {
  const numChars = origin.valid.length
  if (!numChars || candidate.valid.length !== numChars) return 0
  const cellPixels = origin.cells.length / numChars
  if (!Number.isInteger(cellPixels) || candidate.cells.length !== origin.cells.length) return 0
  let iouSum = 0
  let weightSum = 0
  for (let char = 0; char < numChars; char += 1) {
    if (!origin.valid[char]) continue
    weightSum += 1
    if (!candidate.valid[char]) continue
    const base = char * cellPixels
    let intersection = 0
    let union = 0
    for (let i = 0; i < cellPixels; i += 1) {
      const a = origin.cells[base + i]!
      const b = candidate.cells[base + i]!
      if (a < b) { intersection += a; union += b } else { intersection += b; union += a }
    }
    if (union > 0) iouSum += intersection / union
  }
  return weightSum > 0 ? iouSum / weightSum : 0
}

function initializeDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_root (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, visible INTEGER NOT NULL DEFAULT 1, scan_status TEXT NOT NULL DEFAULT 'idle', last_scanned_at INTEGER);
    CREATE TABLE IF NOT EXISTS font_file (id INTEGER PRIMARY KEY, root_id INTEGER NOT NULL REFERENCES library_root(id), path TEXT NOT NULL, normalized_path TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, file_id TEXT, sha256 TEXT NOT NULL, format TEXT, parse_status TEXT NOT NULL DEFAULT 'ready', parse_error TEXT, discovered_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, missing_at INTEGER);
    CREATE TABLE IF NOT EXISTS font_face (id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL REFERENCES font_file(id) ON DELETE CASCADE, face_index INTEGER NOT NULL, family TEXT NOT NULL, subfamily TEXT, preferred_family TEXT, preferred_subfamily TEXT, full_name TEXT, postscript_name TEXT, localized_search TEXT, weight INTEGER, is_variable INTEGER NOT NULL DEFAULT 0, axes_json TEXT, glyph_count INTEGER, language TEXT, cmap_ranges BLOB, UNIQUE(file_id, face_index));
    CREATE TABLE IF NOT EXISTS font_user_data (face_id INTEGER PRIMARY KEY REFERENCES font_face(id) ON DELETE CASCADE, favorite INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '', rating INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS font_search USING fts5(face_id UNINDEXED, family, subfamily, full_name, postscript_name, note, localized_names);
    CREATE TABLE IF NOT EXISTS library_folder (root_id INTEGER NOT NULL REFERENCES library_root(id) ON DELETE CASCADE, path TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (root_id, path));
    CREATE TABLE IF NOT EXISTS font_tag (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS font_face_tag (face_id INTEGER NOT NULL REFERENCES font_face(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES font_tag(id) ON DELETE CASCADE, PRIMARY KEY (face_id, tag_id));
    CREATE TABLE IF NOT EXISTS font_face_link (face_id INTEGER NOT NULL REFERENCES font_face(id) ON DELETE CASCADE, target_face_id INTEGER NOT NULL REFERENCES font_face(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (face_id, target_face_id));
    CREATE TABLE IF NOT EXISTS font_similarity (face_id INTEGER PRIMARY KEY REFERENCES font_face(id) ON DELETE CASCADE, signature_json TEXT NOT NULL, signature_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS activation_session (id TEXT PRIMARY KEY, agent_pid INTEGER NOT NULL, main_pid INTEGER NOT NULL, platform TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, recovery_state TEXT NOT NULL DEFAULT 'open', last_error TEXT);
    CREATE TABLE IF NOT EXISTS activation_record (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES activation_session(id), file_id INTEGER REFERENCES font_file(id) ON DELETE SET NULL, face_id INTEGER REFERENCES font_face(id) ON DELETE SET NULL, path TEXT NOT NULL, normalized_path TEXT NOT NULL, file_system_id TEXT, sha256 TEXT NOT NULL, platform_token TEXT, state TEXT NOT NULL DEFAULT 'inactive', owned_ref_count INTEGER NOT NULL DEFAULT 0 CHECK (owned_ref_count >= 0), last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(session_id, normalized_path));
    CREATE INDEX IF NOT EXISTS font_file_root_idx ON font_file(root_id, missing_at);
    CREATE INDEX IF NOT EXISTS font_face_family_idx ON font_face(family);
    CREATE INDEX IF NOT EXISTS font_face_language_idx ON font_face(language);
    CREATE INDEX IF NOT EXISTS library_folder_root_idx ON library_folder(root_id);
    CREATE INDEX IF NOT EXISTS font_face_tag_tag_idx ON font_face_tag(tag_id);
    CREATE INDEX IF NOT EXISTS font_face_link_face_idx ON font_face_link(face_id);
    CREATE INDEX IF NOT EXISTS font_face_link_target_idx ON font_face_link(target_face_id);
    CREATE INDEX IF NOT EXISTS activation_session_recovery_idx ON activation_session(recovery_state, ended_at);
    CREATE INDEX IF NOT EXISTS activation_record_session_state_idx ON activation_record(session_id, state);
    CREATE INDEX IF NOT EXISTS activation_record_file_state_idx ON activation_record(file_id, state);
  `)
  const folderColumns = db.prepare('PRAGMA table_info(library_folder)').all() as Array<{ name: string }>
  if (!folderColumns.some(column => column.name === 'visible')) {
    db.exec('ALTER TABLE library_folder ADD COLUMN visible INTEGER NOT NULL DEFAULT 1')
  }
  const similarityColumns = db.prepare('PRAGMA table_info(font_similarity)').all() as Array<{ name: string }>
  if (!similarityColumns.some(column => column.name === 'signature_version')) {
    db.exec('ALTER TABLE font_similarity ADD COLUMN signature_version INTEGER NOT NULL DEFAULT 1')
  }
  const legacyLanguageMap: Record<string, string> = {
    '简体': 'fontLanguage.simplifiedChinese',
    '繁体': 'fontLanguage.traditionalChinese',
    '简繁': 'fontLanguage.simplifiedAndTraditionalChinese',
    '日文': 'fontLanguage.japanese',
    '韩文': 'fontLanguage.korean',
    '拉丁': 'fontLanguage.latin',
    '其他': 'fontLanguage.other',
  }
  const updateFaceLanguage = db.prepare('UPDATE font_face SET language = ? WHERE language = ?')
  const updateUserDataLanguage = db.prepare('UPDATE font_user_data SET language = ? WHERE language = ?')
  for (const [oldValue, newValue] of Object.entries(legacyLanguageMap)) {
    updateFaceLanguage.run(newValue, oldValue)
    updateUserDataLanguage.run(newValue, oldValue)
  }
}

const SEARCH_TOKEN_RE = /"([^"]*)"|(\S+)/g

function parseSearchInput(input: string): { match: string; compactText: string; quotedTerms: string[]; hasLooseTerms: boolean } {
  const trimmed = input.trim()
  if (!trimmed) return { match: '', compactText: '%%', quotedTerms: [], hasLooseTerms: false }
  const matchParts: string[] = []
  const compactParts: string[] = []
  const quotedTerms: string[] = []
  SEARCH_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SEARCH_TOKEN_RE.exec(trimmed)) !== null) {
    if (m[1] !== undefined) {
      if (m[1]) quotedTerms.push(m[1].toLowerCase())
    } else {
      const token = m[2]!
      if (/[\p{L}\p{N}]/u.test(token)) matchParts.push(`"${token.replaceAll('"', '""')}"`)
      compactParts.push(token.toLowerCase())
    }
  }
  return {
    match: matchParts.join(' '),
    compactText: `%${compactParts.join('%')}%`,
    quotedTerms,
    hasLooseTerms: compactParts.length > 0,
  }
}

export interface IndexedFace {
  faceIndex: number; family: string; subfamily?: string
  preferredFamily?: string; preferredSubfamily?: string
  fullName?: string; postscriptName?: string; localizedSearch?: string
  weight?: number
  isVariable: boolean; axesJson?: string; glyphCount?: number
  /** Inferred writing system from cmap at index time. */
  language?: string
  /** Compact little-endian u32 range pairs for cmap coverage. */
  cmapRanges?: Buffer | Uint8Array
}
export interface IndexedFile {
  rootId: number; path: string; normalizedPath: string; size: number; mtimeMs: number
  fileId?: string; sha256: string; format: string; faces: IndexedFace[]
}

type FolderTreeNode = LibraryFolderNode & { childMap: Map<string, FolderTreeNode> }

function normalizeFolderKey(path: string) {
  return path.replace(/[\\/]+$/, '').toLowerCase()
}

function splitPathSegments(value: string) {
  return value.split(/[\\/]+/).filter(Boolean)
}

function joinUnderRoot(rootPath: string, segments: string[]) {
  if (!segments.length) return rootPath
  const separator = rootPath.includes('\\') ? '\\' : '/'
  const trimmed = rootPath.replace(/[\\/]+$/, '')
  return `${trimmed}${separator}${segments.join(separator)}`
}

function ensureFolderChild(parent: FolderTreeNode, name: string, path: string, note = '', visible = 1) {
  let child = parent.childMap.get(name)
  if (!child) {
    child = { name, path, note, visible, children: [], childMap: new Map() }
    parent.childMap.set(name, child)
    parent.children.push(child)
  } else if (note && !child.note) {
    child.note = note
  }
  return child
}

function finalizeFolderTree(node: FolderTreeNode): LibraryFolderNode {
  node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return {
    name: node.name,
    path: node.path,
    note: node.note,
    visible: node.visible,
    children: node.children.map(child => finalizeFolderTree(child as FolderTreeNode)),
  }
}

function normalizePathPrefix(pathPrefix: string) {
  return pathPrefix.replace(/[\\/]+$/, '')
}

function pathPrefixMatchers(pathPrefix: string) {
  const prefix = normalizePathPrefix(pathPrefix)
  return {
    exact: prefix,
    slash: `${prefix}/`,
    backslash: `${prefix}\\`,
  }
}

export class FontDatabase {
  private readonly db: Database.Database
  /** Source representative face -> sorted target representative IDs and scores. */
  private readonly similarityCache = new Map<string, Array<{ faceId: number; similarity: number }>>()
  constructor(file: string) {
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('foreign_keys = ON')
    initializeDatabase(this.db)
  }
  private insertSearchRow(faceId: number, face: { family: string; subfamily?: string | null; preferredFamily?: string | null; preferredSubfamily?: string | null; fullName?: string | null; postscriptName?: string | null; localizedSearch?: string | null }, note: string) {
    const familySearch = [face.family, face.preferredFamily].filter((value, index, list) => value && list.indexOf(value) === index).join(' ')
    const subfamilySearch = [face.subfamily, face.preferredSubfamily].filter((value, index, list) => value && list.indexOf(value) === index).join(' ')
    this.db.prepare('INSERT INTO font_search(face_id,family,subfamily,full_name,postscript_name,note,localized_names) VALUES(?,?,?,?,?,?,?)').run(faceId, familySearch, subfamilySearch, face.fullName ?? '', face.postscriptName ?? '', note, face.localizedSearch ?? '')
  }
  addRoot(path: string) {
    const result = this.db.prepare('INSERT INTO library_root(path) VALUES(?) ON CONFLICT(path) DO UPDATE SET enabled=1 RETURNING id').get(path) as { id: number }
    return result.id
  }
  removeRoot(rootId: number) {
    const now = Date.now()
    const remove = this.db.transaction(() => {
      this.db.prepare('UPDATE library_root SET enabled=0 WHERE id=?').run(rootId)
      this.db.prepare('UPDATE font_file SET missing_at=COALESCE(missing_at, ?) WHERE root_id=?').run(now, rootId)
    })
    remove()
  }
  roots() {
    return this.db.prepare('SELECT id, path, note, CAST(visible AS INTEGER) AS visible, scan_status AS scanStatus FROM library_root WHERE enabled=1 ORDER BY path').all() as Array<{ id: number; path: string; note: string; visible: number; scanStatus: string }>
  }
  rootTrees(): LibraryRootTree[] {
    const roots = this.roots()
    if (!roots.length) return []
    const files = this.db.prepare(`SELECT f.root_id AS rootId, f.path AS path
      FROM font_file f JOIN library_root lr ON lr.id=f.root_id
      WHERE f.missing_at IS NULL AND lr.enabled=1
      ORDER BY f.path`).all() as Array<{ rootId: number; path: string }>
    const folderSettings = this.db.prepare(`SELECT root_id AS rootId, path, note, CAST(visible AS INTEGER) AS visible FROM library_folder WHERE note <> '' OR visible=0`).all() as Array<{ rootId: number; path: string; note: string; visible: number }>
    const settingsByRoot = new Map<number, Map<string, { note: string; visible: number }>>()
    for (const item of folderSettings) {
      let map = settingsByRoot.get(item.rootId)
      if (!map) {
        map = new Map()
        settingsByRoot.set(item.rootId, map)
      }
      map.set(normalizeFolderKey(item.path), { note: item.note, visible: item.visible })
    }
    const trees = new Map<number, FolderTreeNode>()
    for (const root of roots) {
      trees.set(root.id, { name: '', path: root.path, note: root.note, visible: root.visible, children: [], childMap: new Map() })
    }
    for (const file of files) {
      const tree = trees.get(file.rootId)
      if (!tree) continue
      const root = roots.find(item => item.id === file.rootId)
      if (!root) continue
      const settings = settingsByRoot.get(file.rootId)
      const rootSegments = splitPathSegments(root.path)
      const fileSegments = splitPathSegments(file.path)
      let offset = 0
      while (offset < rootSegments.length && offset < fileSegments.length && rootSegments[offset].toLowerCase() === fileSegments[offset].toLowerCase()) offset += 1
      const relative = fileSegments.slice(offset, -1)
      let current = tree
      const walked: string[] = []
      for (const segment of relative) {
        walked.push(segment)
        const folderPath = joinUnderRoot(root.path, walked)
        const setting = settings?.get(normalizeFolderKey(folderPath))
        current = ensureFolderChild(current, segment, folderPath, setting?.note ?? '', setting?.visible ?? 1)
      }
    }
    for (const item of folderSettings) {
      const tree = trees.get(item.rootId)
      const root = roots.find(entry => entry.id === item.rootId)
      if (!tree || !root) continue
      if (normalizeFolderKey(item.path) === normalizeFolderKey(root.path)) continue
      const rootSegments = splitPathSegments(root.path)
      const folderSegments = splitPathSegments(item.path)
      let offset = 0
      while (offset < rootSegments.length && offset < folderSegments.length && rootSegments[offset].toLowerCase() === folderSegments[offset].toLowerCase()) offset += 1
      const relative = folderSegments.slice(offset)
      if (!relative.length) continue
      let current = tree
      const walked: string[] = []
      for (const segment of relative) {
        walked.push(segment)
        const folderPath = joinUnderRoot(root.path, walked)
        current = ensureFolderChild(current, segment, folderPath, walked.length === relative.length ? item.note : '', walked.length === relative.length ? item.visible : 1)
      }
    }
    return roots.map(root => {
      const tree = trees.get(root.id)!
      return {
        id: root.id,
        path: root.path,
        note: root.note,
        visible: root.visible,
        scanStatus: root.scanStatus,
        children: finalizeFolderTree(tree).children,
      }
    })
  }
  setScanStatus(rootId: number, status: string) { this.db.prepare('UPDATE library_root SET scan_status=? WHERE id=?').run(status, rootId) }
  setLastScannedAt(rootId: number, at = Date.now()) { this.db.prepare('UPDATE library_root SET last_scanned_at=? WHERE id=?').run(at, rootId) }
  listFingerprints(rootId: number, pathPrefix?: string) {
    const params: Record<string, unknown> = { rootId }
    const clauses = ['root_id = @rootId']
    if (pathPrefix) {
      const matchers = pathPrefixMatchers(pathPrefix)
      clauses.push('(path = @pathExact OR path LIKE @pathSlash OR path LIKE @pathBackslash)')
      params.pathExact = matchers.exact
      params.pathSlash = `${matchers.slash}%`
      params.pathBackslash = `${matchers.backslash}%`
    }
    // Files without cmap ranges must be re-parsed so coverage/subset preview can stay index-backed.
    clauses.push(`EXISTS (
      SELECT 1 FROM font_face ff
      WHERE ff.file_id = font_file.id AND ff.cmap_ranges IS NOT NULL
    )`)
    return this.db.prepare(`SELECT normalized_path AS normalizedPath, size, mtime_ms AS mtimeMs FROM font_file WHERE ${clauses.join(' AND ')}`).all(params) as Array<{ normalizedPath: string; size: number; mtimeMs: number }>
  }
  confirmPresent(normalizedPath: string) {
    this.db.prepare('UPDATE font_file SET missing_at=NULL WHERE normalized_path=? AND missing_at IS NOT NULL').run(normalizedPath)
  }
  private deleteFontFilesWhere(whereSql: string, params: unknown[]) {
    this.db.prepare(`DELETE FROM font_search WHERE face_id IN (
      SELECT ff.id FROM font_face ff JOIN font_file f ON f.id=ff.file_id WHERE ${whereSql}
    )`).run(...params)
    this.db.prepare(`DELETE FROM font_file WHERE ${whereSql}`).run(...params)
    this.db.prepare('DELETE FROM font_tag WHERE id NOT IN (SELECT DISTINCT tag_id FROM font_face_tag)').run()
  }

  /** Drop index rows for files not seen in the latest scan (hard delete). */
  markMissingNotSeen(rootId: number, seenNormalizedPaths: Iterable<string>, pathPrefix?: string) {
    const run = this.db.transaction(() => {
      this.db.exec('CREATE TEMP TABLE IF NOT EXISTS scan_seen (normalized_path TEXT PRIMARY KEY)')
      this.db.exec('DELETE FROM scan_seen')
      const insert = this.db.prepare('INSERT OR IGNORE INTO scan_seen(normalized_path) VALUES(?)')
      for (const path of seenNormalizedPaths) insert.run(path)
      let where = `root_id=? AND normalized_path NOT IN (SELECT normalized_path FROM scan_seen)`
      const params: unknown[] = [rootId]
      if (pathPrefix) {
        const matchers = pathPrefixMatchers(pathPrefix)
        where += ' AND (path = ? OR path LIKE ? OR path LIKE ?)'
        params.push(matchers.exact, `${matchers.slash}%`, `${matchers.backslash}%`)
      }
      this.deleteFontFilesWhere(where, params)
      this.db.exec('DELETE FROM scan_seen')
    })
    run()
  }

  /** Wipe font index data and keep library roots / folder notes. */
  clearFontIndex() {
    const run = this.db.transaction(() => {
      this.db.exec('DELETE FROM font_search')
      this.db.exec('DELETE FROM font_file')
      this.db.exec('DELETE FROM font_tag')
      this.db.exec("UPDATE library_root SET scan_status='idle', last_scanned_at=NULL")
    })
    run()
  }
  setRootNote(rootId: number, note: string) { this.db.prepare('UPDATE library_root SET note=? WHERE id=?').run(note, rootId) }
  setFolderNote(rootId: number, path: string, note: string) {
    const root = this.roots().find(item => item.id === rootId)
    if (!root) throw new Error('找不到该字体目录。')
    const trimmedNote = note.trim()
    if (normalizeFolderKey(path) === normalizeFolderKey(root.path)) {
      this.setRootNote(rootId, trimmedNote)
      return
    }
    if (!trimmedNote) {
      this.db.prepare('DELETE FROM library_folder WHERE root_id=? AND path=? AND visible=1').run(rootId, path)
      return
    }
    this.db.prepare(`INSERT INTO library_folder(root_id, path, note) VALUES(?,?,?)
      ON CONFLICT(root_id, path) DO UPDATE SET note=excluded.note`).run(rootId, path, trimmedNote)
  }
  getFolderNote(rootId: number, path: string) {
    const root = this.roots().find(item => item.id === rootId)
    if (!root) return ''
    if (normalizeFolderKey(path) === normalizeFolderKey(root.path)) return root.note
    const row = this.db.prepare('SELECT note FROM library_folder WHERE root_id=? AND path=?').get(rootId, path) as { note: string } | undefined
    return row?.note ?? ''
  }
  setRootVisible(rootId: number, visible: boolean) { this.db.prepare('UPDATE library_root SET visible=? WHERE id=?').run(Number(visible), rootId) }
  setFolderVisible(rootId: number, path: string, visible: boolean) {
    const root = this.roots().find(item => item.id === rootId)
    if (!root) throw new Error('找不到该字体目录。')
    if (normalizeFolderKey(path) === normalizeFolderKey(root.path)) {
      this.setRootVisible(rootId, visible)
      return
    }
    this.db.prepare(`INSERT INTO library_folder(root_id,path,visible) VALUES(?,?,?)
      ON CONFLICT(root_id,path) DO UPDATE SET visible=excluded.visible`).run(rootId, path, Number(visible))
  }
  private applyFolderVisibilityFilter(where: string[]) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM library_folder hidden
      WHERE hidden.root_id=f.root_id AND hidden.visible=0
        AND (f.path=RTRIM(hidden.path, '/\\') OR f.path LIKE RTRIM(hidden.path, '/\\') || '/%' OR f.path LIKE RTRIM(hidden.path, '/\\') || '\\%')
    )`)
  }
  private applyFolderFilter(where: string[], params: Record<string, unknown>, filter?: FolderFilter) {
    if (filter?.rootId) {
      where.push('f.root_id = @rootId')
      params.rootId = filter.rootId
    }
    if (filter?.pathPrefix) {
      const matchers = pathPrefixMatchers(filter.pathPrefix)
      where.push('(f.path = @pathExact OR f.path LIKE @pathSlash OR f.path LIKE @pathBackslash)')
      params.pathExact = matchers.exact
      params.pathSlash = `${matchers.slash}%`
      params.pathBackslash = `${matchers.backslash}%`
    }
  }
  getFileFingerprint(normalizedPath: string) { return this.db.prepare('SELECT size, mtime_ms AS mtimeMs FROM font_file WHERE normalized_path=?').get(normalizedPath) as { size: number; mtimeMs: number } | undefined }
  upsertFile(input: IndexedFile) {
    const now = Date.now()
    const write = this.db.transaction(() => {
      this.similarityCache.clear()
      const file = this.db.prepare(`INSERT INTO font_file(root_id,path,normalized_path,size,mtime_ms,file_id,sha256,format,discovered_at,updated_at,missing_at)
        VALUES(@rootId,@path,@normalizedPath,@size,@mtimeMs,@fileId,@sha256,@format,@now,@now,NULL)
        ON CONFLICT(normalized_path) DO UPDATE SET root_id=@rootId,path=@path,size=@size,mtime_ms=@mtimeMs,file_id=@fileId,sha256=@sha256,format=@format,parse_status='ready',parse_error=NULL,updated_at=@now,missing_at=NULL RETURNING id`).get({ ...input, fileId: input.fileId ?? null, now }) as { id: number }
      this.db.prepare('DELETE FROM font_search WHERE face_id IN (SELECT id FROM font_face WHERE file_id=?)').run(file.id)
      this.db.prepare('DELETE FROM font_similarity WHERE face_id IN (SELECT id FROM font_face WHERE file_id=?)').run(file.id)
      const indexes = input.faces.map(face => face.faceIndex)
      this.db.prepare(`DELETE FROM font_face WHERE file_id=? AND face_index NOT IN (${indexes.length ? indexes.map(() => '?').join(',') : '-1'})`).run(file.id, ...indexes)
      const insert = this.db.prepare(`INSERT INTO font_face(file_id,face_index,family,subfamily,preferred_family,preferred_subfamily,full_name,postscript_name,localized_search,weight,is_variable,axes_json,glyph_count,language,cmap_ranges) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(file_id,face_index) DO UPDATE SET family=excluded.family,subfamily=excluded.subfamily,preferred_family=excluded.preferred_family,preferred_subfamily=excluded.preferred_subfamily,full_name=excluded.full_name,postscript_name=excluded.postscript_name,localized_search=excluded.localized_search,weight=excluded.weight,is_variable=excluded.is_variable,axes_json=excluded.axes_json,glyph_count=excluded.glyph_count,language=excluded.language,cmap_ranges=excluded.cmap_ranges RETURNING id`)
      for (const face of input.faces) {
        const cmapRanges = face.cmapRanges
          ? Buffer.isBuffer(face.cmapRanges) ? face.cmapRanges : Buffer.from(face.cmapRanges)
          : null
        const result = insert.get(file.id, face.faceIndex, face.family, face.subfamily ?? null, face.preferredFamily ?? null, face.preferredSubfamily ?? null, face.fullName ?? null, face.postscriptName ?? null, face.localizedSearch ?? null, face.weight ?? null, Number(face.isVariable), face.axesJson ?? null, face.glyphCount ?? null, face.language ?? null, cmapRanges) as { id: number }
        const note = this.db.prepare('SELECT note FROM font_user_data WHERE face_id=?').get(result.id) as { note: string } | undefined
        this.insertSearchRow(result.id, face, note?.note ?? '')
      }
    })
    write()
  }
  query(input: {
    text: string
    cursor?: number
    limit: number
    favorite?: boolean
    weightMin?: number
    weightMax?: number
    italic?: boolean
    variable?: boolean
    languages?: Array<typeof FONT_LANGUAGES[number]>
    tags?: string[]
    formats?: string[]
    glyphCountMin?: number
    glyphCountMax?: number
    rootId?: number
    pathPrefix?: string
    faceIds?: number[]
    excludeFaceIds?: number[]
    includeTotal?: boolean
    groupByFamily?: boolean
  }): FontPage {
    if (input.faceIds && input.faceIds.length === 0) return { items: [], total: 0 }
    const where = ['f.missing_at IS NULL', 'lr.enabled=1', 'lr.visible=1']
    this.applyFolderVisibilityFilter(where)
    const parsedSearch = parseSearchInput(input.text)
    const params: Record<string, unknown> = {
      cursor: input.cursor ?? 0,
      favorite: Number(input.favorite),
      match: parsedSearch.match,
      compactText: parsedSearch.compactText,
      weightMin: input.weightMin ?? 0,
      weightMax: input.weightMax ?? 0,
      glyphCountMin: input.glyphCountMin ?? 0,
      glyphCountMax: input.glyphCountMax ?? 0,
      limit: input.limit + 1,
    }
    if (input.favorite !== undefined) where.push('COALESCE(ud.favorite, 0) = @favorite')
    const looseSearch = "REPLACE(LOWER(COALESCE(ff.family, '') || COALESCE(ff.preferred_family, '') || COALESCE(ff.subfamily, '') || COALESCE(ff.preferred_subfamily, '') || COALESCE(ff.full_name, '') || COALESCE(ff.postscript_name, '') || COALESCE(ff.localized_search, '') || COALESCE(ud.note, '')), ' ', '') LIKE @compactText"
    if (parsedSearch.match) where.push(`(ff.id IN (SELECT face_id FROM font_search WHERE font_search MATCH @match) OR ${looseSearch})`)
    else if (parsedSearch.hasLooseTerms) where.push(looseSearch)
    parsedSearch.quotedTerms.forEach((term, index) => {
      const key = `quotedTerm${index}`
      params[key] = term
      where.push(`(
        INSTR(LOWER(COALESCE(ff.family, '')), @${key}) > 0
        OR INSTR(LOWER(COALESCE(ff.preferred_family, '')), @${key}) > 0
        OR INSTR(LOWER(COALESCE(ff.subfamily, '')), @${key}) > 0
        OR INSTR(LOWER(COALESCE(ff.preferred_subfamily, '')), @${key}) > 0
        OR INSTR(LOWER(COALESCE(ff.full_name, '')), @${key}) > 0
        OR INSTR(LOWER(COALESCE(ff.postscript_name, '')), @${key}) > 0
        OR INSTR(LOWER(COALESCE(ud.note, '')), @${key}) > 0
        OR INSTR(LOWER(COALESCE(ff.localized_search, '')), @${key}) > 0
      )`)
    })
    if (input.weightMin !== undefined) where.push('COALESCE(ff.weight, 400) >= @weightMin')
    if (input.weightMax !== undefined) where.push('COALESCE(ff.weight, 400) <= @weightMax')
    if (input.italic === true) where.push("(LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, '')) LIKE '%italic%' OR LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, '')) LIKE '%oblique%')")
    if (input.italic === false) where.push("LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, '')) NOT LIKE '%italic%' AND LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, '')) NOT LIKE '%oblique%'")
    if (input.variable === true) where.push('ff.is_variable = 1')
    if (input.variable === false) where.push('ff.is_variable = 0')
    if (input.languages?.length) {
      const languages = [...new Set(input.languages)]
      const keys = languages.map((_, index) => `@language${index}`)
      languages.forEach((language, index) => { params[`language${index}`] = language })
      // Family language edits are persisted to every face, so no per-row family subquery is needed.
      where.push(`COALESCE(NULLIF(ud.language, ''), ff.language, '') IN (${keys.join(',')})`)
    }
    if (input.glyphCountMin !== undefined) where.push('COALESCE(ff.glyph_count, 0) >= @glyphCountMin')
    if (input.glyphCountMax !== undefined) where.push('COALESCE(ff.glyph_count, 0) <= @glyphCountMax')
    if (input.formats?.length) {
      const formats = [...new Set(input.formats.map(value => value.trim().toLowerCase()).filter(Boolean))]
      if (formats.length) {
        const keys = formats.map((_, index) => `@format${index}`)
        formats.forEach((format, index) => { params[`format${index}`] = format })
        where.push(`LOWER(COALESCE(f.format, '')) IN (${keys.join(',')})`)
      }
    }
    if (input.tags?.length) {
      const tags = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))]
      if (tags.length) {
        const keys = tags.map((_, index) => `@tag${index}`)
        tags.forEach((tag, index) => { params[`tag${index}`] = tag })
        params.tagCount = tags.length
        // Match faces that have all selected tags (family-shared tags still live on each face).
        where.push(`(
          SELECT COUNT(DISTINCT t.name)
          FROM font_face_tag ft
          JOIN font_tag t ON t.id = ft.tag_id
          WHERE ft.face_id = ff.id AND t.name IN (${keys.join(',')})
        ) = @tagCount`)
      }
    }
    if (input.faceIds?.length) {
      const keys = input.faceIds.map((_, index) => `@faceId${index}`)
      input.faceIds.forEach((id, index) => { params[`faceId${index}`] = id })
      where.push(`ff.id IN (${keys.join(',')})`)
    }
    if (input.excludeFaceIds?.length) {
      const keys = input.excludeFaceIds.map((_, index) => `@excludeFaceId${index}`)
      input.excludeFaceIds.forEach((id, index) => { params[`excludeFaceId${index}`] = id })
      where.push(`ff.id NOT IN (${keys.join(',')})`)
    }
    this.applyFolderFilter(where, params, { rootId: input.rootId, pathPrefix: input.pathPrefix })
    // FTS is only consulted by the MATCH subquery above; joining it here makes every count scan it.
    const joins = 'FROM font_face ff JOIN font_file f ON f.id=ff.file_id JOIN library_root lr ON lr.id=f.root_id LEFT JOIN font_user_data ud ON ud.face_id=ff.id'
    const selectFields = 'ff.id, ff.file_id AS fileId, ff.family, ff.subfamily AS subfamily, ff.preferred_family AS preferredFamily, ff.preferred_subfamily AS preferredSubfamily, ff.full_name AS fullName, f.format, ff.postscript_name AS postscriptName, ff.weight AS weight, CAST(ff.is_variable AS INTEGER) AS isVariable, CAST(COALESCE(ud.favorite,0) AS INTEGER) AS favorite'
    const whereSql = where.join(' AND ')
    let total: number | undefined
    let rows: FontFaceSummary[]

    if (input.groupByFamily) {
      // Rank faces after applying all filters so a family contributes its Regular face when present.
      const grouped = `WITH matching AS (
        SELECT ${selectFields} ${joins} WHERE ${whereSql}
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(preferredFamily, ''), family)
          ORDER BY
            CASE
              WHEN LOWER(COALESCE(preferredSubfamily, subfamily, '')) = 'regular' THEN 0
              WHEN weight BETWEEN 301 AND 450 THEN 1
              ELSE 2
            END,
            ABS(COALESCE(weight, 400) - 400),
            id
        ) AS family_rank
        FROM matching
      )`
      total = input.includeTotal === false
        ? undefined
        : (this.db.prepare(`${grouped} SELECT COUNT(*) AS total FROM ranked WHERE family_rank=1`).get(params) as { total: number }).total
      rows = this.db.prepare(`${grouped}
        SELECT id, fileId, family, subfamily, preferredFamily, preferredSubfamily, fullName, format, postscriptName, weight, isVariable, favorite
        FROM ranked
        WHERE family_rank=1 AND id > @cursor
        ORDER BY id
        LIMIT @limit`).all(params) as FontFaceSummary[]
    } else {
      total = input.includeTotal === false
        ? undefined
        : (this.db.prepare(`SELECT COUNT(*) AS total ${joins} WHERE ${whereSql}`).get(params) as { total: number }).total
      rows = this.db.prepare(`SELECT ${selectFields}
        ${joins}
        WHERE ${[...where, 'ff.id > @cursor'].join(' AND ')} ORDER BY ff.id LIMIT @limit`).all(params) as FontFaceSummary[]
    }
    const hasNext = rows.length > input.limit
    const items = rows.slice(0, input.limit).map(row => ({ ...row, isVariable: Boolean(row.isVariable), favorite: Boolean(row.favorite) }))
    return { items, total, nextCursor: hasNext ? items.at(-1)?.id : undefined }
  }
  private familyFaceIds(faceId: number) {
    const source = this.db.prepare('SELECT family, preferred_family AS preferredFamily FROM font_face WHERE id=?').get(faceId) as { family: string; preferredFamily: string | null } | undefined
    if (!source) return null
    const keys = [...new Set([source.family, source.preferredFamily].filter((value): value is string => Boolean(value)))]
    return this.db.prepare(`SELECT id FROM font_face WHERE family IN (${keys.map(() => '?').join(',')}) OR preferred_family IN (${keys.map(() => '?').join(',')})`).all(...keys, ...keys) as Array<{ id: number }>
  }

  private normalizeTags(tags: string[]) {
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const raw of tags) {
      const name = raw.trim().replace(/\s+/g, ' ')
      if (!name) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      normalized.push(name.slice(0, 32))
      if (normalized.length >= 20) break
    }
    return normalized
  }

  private tagsForFace(faceId: number) {
    return (this.db.prepare(`SELECT t.name AS name
      FROM font_face_tag ft
      JOIN font_tag t ON t.id=ft.tag_id
      WHERE ft.face_id=?
      ORDER BY t.name COLLATE NOCASE`).all(faceId) as Array<{ name: string }>).map(row => row.name)
  }

  listTags() {
    return (this.db.prepare(`
      SELECT t.name
      FROM font_tag t
      LEFT JOIN font_face_tag ft ON ft.tag_id = t.id
      GROUP BY t.id
      ORDER BY COUNT(ft.face_id) DESC, t.name COLLATE NOCASE
    `).all() as Array<{ name: string }>).map(row => row.name)
  }

  updateFamilyTags(faceId: number, tags: string[]) {
    const faces = this.familyFaceIds(faceId)
    if (!faces) throw new Error('找不到该字体。')
    const normalized = this.normalizeTags(tags)
    const ensureTag = this.db.prepare('INSERT INTO font_tag(name, created_at) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET name=name RETURNING id')
    const clear = this.db.prepare('DELETE FROM font_face_tag WHERE face_id=?')
    const link = this.db.prepare('INSERT OR IGNORE INTO font_face_tag(face_id, tag_id) VALUES(?, ?)')
    const prune = this.db.prepare('DELETE FROM font_tag WHERE id NOT IN (SELECT DISTINCT tag_id FROM font_face_tag)')
    const write = this.db.transaction(() => {
      const tagIds = normalized.map(name => (ensureTag.get(name, Date.now()) as { id: number }).id)
      for (const face of faces) {
        clear.run(face.id)
        for (const tagId of tagIds) link.run(face.id, tagId)
      }
      prune.run()
    })
    write()
  }

  faceDetails(id: number) {
    const row = this.db.prepare(`SELECT ff.id, ff.file_id AS fileId, ff.family, ff.subfamily AS subfamily, ff.preferred_family AS preferredFamily, ff.preferred_subfamily AS preferredSubfamily, ff.full_name AS fullName, f.format, ff.postscript_name AS postscriptName, ff.weight AS weight, CAST(ff.is_variable AS INTEGER) AS isVariable, CAST(COALESCE(ud.favorite, 0) AS INTEGER) AS favorite, ff.axes_json AS axesJson, ff.glyph_count AS glyphCount, f.path, f.size AS fileSize, f.mtime_ms AS modifiedAt, COALESCE((SELECT shared.note FROM font_face shared_face JOIN font_user_data shared ON shared.face_id=shared_face.id WHERE shared_face.family=ff.family AND shared.note<>'' ORDER BY shared.updated_at DESC LIMIT 1), '') AS note, COALESCE((SELECT shared.language FROM font_face shared_face JOIN font_user_data shared ON shared.face_id=shared_face.id WHERE shared_face.family=ff.family AND shared.language<>'' ORDER BY shared.updated_at DESC LIMIT 1), '') AS language
      FROM font_face ff JOIN font_file f ON f.id=ff.file_id LEFT JOIN font_user_data ud ON ud.face_id=ff.id
      WHERE ff.id=? AND f.missing_at IS NULL`).get(id) as (Omit<FontFaceDetail, 'axes' | 'localizedNames' | 'unicodeBlocks' | 'cjkCoverage' | 'cjkCharacterCount' | 'inferredLanguage' | 'metrics' | 'credits' | 'openTypeFeatures' | 'isVariable' | 'favorite' | 'tags' | 'language'> & { axesJson: string | null; isVariable: number; favorite: number; language: string }) | undefined
    if (!row) return undefined
    let axes: FontFaceDetail['axes'] = []
    try {
      const parsed = JSON.parse(row.axesJson ?? '{}') as Record<string, { name?: string; min?: number; default?: number; max?: number }>
      axes = Object.entries(parsed).map(([tag, axis]) => ({ tag, name: axis.name ?? tag, min: axis.min ?? 0, default: axis.default ?? 0, max: axis.max ?? 0 }))
    } catch { /* Invalid metadata should not prevent opening the font details. */ }
    const { axesJson, language, ...face } = row
    const validLanguages = new Set<string>(FONT_LANGUAGES)
    return {
      ...face,
      isVariable: Boolean(face.isVariable),
      favorite: Boolean(face.favorite),
      language: validLanguages.has(language) ? language as FontFaceDetail['language'] : null,
      axes,
      tags: this.tagsForFace(id),
    }
  }
  family(family: string, filter?: FolderFilter) {
    const where = ['(ff.family=@family OR ff.preferred_family=@family)', 'f.missing_at IS NULL', 'lr.enabled=1', 'lr.visible=1']
    this.applyFolderVisibilityFilter(where)
    const params: Record<string, unknown> = { family }
    this.applyFolderFilter(where, params, filter)
    const rows = this.db.prepare(`SELECT ff.id, ff.file_id AS fileId, ff.family, ff.subfamily AS subfamily, ff.preferred_family AS preferredFamily, ff.preferred_subfamily AS preferredSubfamily, ff.full_name AS fullName, f.format, ff.postscript_name AS postscriptName, ff.weight AS weight, CAST(ff.is_variable AS INTEGER) AS isVariable, CAST(COALESCE(ud.favorite, 0) AS INTEGER) AS favorite
      FROM font_face ff JOIN font_file f ON f.id=ff.file_id JOIN library_root lr ON lr.id=f.root_id LEFT JOIN font_user_data ud ON ud.face_id=ff.id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(ff.weight, 400), ff.id`).all(params) as FontFaceSummary[]
    return rows.map(row => ({ ...row, isVariable: Boolean(row.isVariable), favorite: Boolean(row.favorite) }))
  }
  nextSimilarityJob(mode: SimilarityMode = 'family', priorityFaceId?: number) {
    if (mode === 'face') {
      return this.db.prepare(`SELECT ff.id AS faceId, f.path, ff.face_index AS faceIndex
        FROM font_face ff JOIN font_file f ON f.id=ff.file_id JOIN library_root lr ON lr.id=f.root_id
        WHERE f.missing_at IS NULL AND lr.enabled=1 AND NOT EXISTS (SELECT 1 FROM font_similarity fs WHERE fs.face_id=ff.id AND fs.signature_version=${SIMILARITY_VERSION})
        ORDER BY CASE WHEN ff.id=? THEN 0 ELSE 1 END, ff.id LIMIT 1`).get(priorityFaceId ?? 0) as { faceId: number; path: string; faceIndex: number } | undefined
    }
    return this.db.prepare(`WITH ranked AS (
      SELECT ff.id AS faceId, f.path, ff.face_index AS faceIndex,
        ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(ff.preferred_family, ''), ff.family) ORDER BY
          CASE WHEN LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, '')) = 'regular' THEN 0
            WHEN ff.weight BETWEEN 301 AND 450 THEN 1 ELSE 2 END,
          ABS(COALESCE(ff.weight, 400) - 400), ff.id) AS familyRank
      FROM font_face ff JOIN font_file f ON f.id=ff.file_id JOIN library_root lr ON lr.id=f.root_id
      WHERE f.missing_at IS NULL AND lr.enabled=1 AND NOT EXISTS (SELECT 1 FROM font_similarity fs WHERE fs.face_id=ff.id AND fs.signature_version=${SIMILARITY_VERSION})
    ) SELECT faceId, path, faceIndex FROM ranked WHERE familyRank=1 ORDER BY faceId LIMIT 1`).get() as { faceId: number; path: string; faceIndex: number } | undefined
  }
  saveSimilaritySignature(faceId: number, signature: SimSignature) {
    if (!signature || !Array.isArray(signature.valid) || !Array.isArray(signature.cells) || signature.valid.some(value => !Number.isFinite(value)) || signature.cells.some(value => !Number.isFinite(value))) return
    const save = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO font_similarity(face_id,signature_json,signature_version,created_at) VALUES(?,?,?,?)
        ON CONFLICT(face_id) DO UPDATE SET signature_json=excluded.signature_json,signature_version=excluded.signature_version,created_at=excluded.created_at`).run(faceId, JSON.stringify(signature), SIMILARITY_VERSION, Date.now())
      // A changed or newly available representative can affect every family's ranking.
      this.similarityCache.clear()
    })
    save()
  }
  markSimilarityUnavailable(faceId: number) {
    // Keep a terminal marker so one damaged/unsupported font cannot retry forever.
    this.saveSimilaritySignature(faceId, { v: 3, valid: [], aspects: [], cells: [] })
  }
  similar(faceId: number, mode: SimilarityMode = 'family') {
    // Family mode compares Regular (or closest-to-Regular) representatives. Face mode
    // compares the selected face against every indexed face from other families.
    const source = mode === 'face'
      ? this.db.prepare(`SELECT fs.face_id AS sourceId, COALESCE(NULLIF(ff.preferred_family, ''), ff.family) AS familyName, fs.signature_json AS signatureJson
        FROM font_similarity fs JOIN font_face ff ON ff.id=fs.face_id
        WHERE fs.face_id=? AND fs.signature_version=${SIMILARITY_VERSION}`).get(faceId) as { sourceId: number; familyName: string; signatureJson: string } | undefined
      : this.db.prepare(`WITH source_family AS (
      SELECT COALESCE(NULLIF(preferred_family, ''), family) AS familyName FROM font_face WHERE id=?
    ), representative AS (
      SELECT ff.id FROM font_face ff JOIN source_family sf ON COALESCE(NULLIF(ff.preferred_family, ''), ff.family)=sf.familyName
      ORDER BY CASE WHEN LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, ''))='regular' THEN 0 WHEN ff.weight BETWEEN 301 AND 450 THEN 1 ELSE 2 END,
        ABS(COALESCE(ff.weight, 400)-400), ff.id LIMIT 1
    ) SELECT fs.face_id AS sourceId, sf.familyName, fs.signature_json AS signatureJson FROM font_similarity fs CROSS JOIN source_family sf WHERE fs.face_id=(SELECT id FROM representative) AND fs.signature_version=${SIMILARITY_VERSION}`).get(faceId) as { sourceId: number; familyName: string; signatureJson: string } | undefined
    if (!source) return []
    const origin = parseSignature(source.signatureJson)
    if (!origin) return []
    const cacheKey = `${mode}:${source.sourceId}`
    let scores = this.similarityCache.get(cacheKey)
    if (!scores) {
      const candidates = mode === 'face'
        ? this.db.prepare(`SELECT fs.face_id AS faceId, fs.signature_json AS signatureJson
          FROM font_similarity fs JOIN font_face ff ON ff.id=fs.face_id
          WHERE ff.id<>? AND COALESCE(NULLIF(ff.preferred_family, ''), ff.family)<>? AND fs.signature_version=${SIMILARITY_VERSION}`).all(source.sourceId, source.familyName) as Array<{ faceId: number; signatureJson: string }>
        : this.db.prepare(`WITH ranked AS (
          SELECT ff.id, ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(ff.preferred_family, ''), ff.family) ORDER BY
            CASE WHEN LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, ''))='regular' THEN 0 WHEN ff.weight BETWEEN 301 AND 450 THEN 1 ELSE 2 END,
            ABS(COALESCE(ff.weight, 400)-400), ff.id) AS familyRank
          FROM font_face ff
        ) SELECT fs.face_id AS faceId, fs.signature_json AS signatureJson
          FROM font_similarity fs JOIN ranked r ON r.id=fs.face_id JOIN font_face ff ON ff.id=fs.face_id
          WHERE r.familyRank=1 AND ff.id<>? AND COALESCE(NULLIF(ff.preferred_family, ''), ff.family)<>? AND fs.signature_version=${SIMILARITY_VERSION}`).all(source.sourceId, source.familyName) as Array<{ faceId: number; signatureJson: string }>
      scores = candidates.flatMap(candidate => {
        const vector = parseSignature(candidate.signatureJson)
        if (!vector) return []
        const score = iouScore(origin, vector)
        if (score <= 0) return []
        return [{ faceId: candidate.faceId, similarity: Math.round(score * 100) }]
      }).sort((a, b) => b.similarity - a.similarity || a.faceId - b.faceId)
      this.similarityCache.set(cacheKey, scores)
    }
      const rows = this.db.prepare(`SELECT ff.id, ff.file_id AS fileId, ff.family, ff.subfamily AS subfamily, ff.preferred_family AS preferredFamily, ff.preferred_subfamily AS preferredSubfamily, ff.full_name AS fullName, f.format, ff.postscript_name AS postscriptName, ff.weight, CAST(ff.is_variable AS INTEGER) AS isVariable, CAST(COALESCE(ud.favorite,0) AS INTEGER) AS favorite
      FROM font_face ff JOIN font_file f ON f.id=ff.file_id JOIN library_root lr ON lr.id=f.root_id LEFT JOIN font_user_data ud ON ud.face_id=ff.id
      WHERE f.missing_at IS NULL AND lr.enabled=1 AND lr.visible=1
        AND NOT EXISTS (
          SELECT 1 FROM library_folder hidden
          WHERE hidden.root_id=f.root_id AND hidden.visible=0
            AND (f.path=RTRIM(hidden.path, '/\\') OR f.path LIKE RTRIM(hidden.path, '/\\') || '/%' OR f.path LIKE RTRIM(hidden.path, '/\\') || '\\%')
        )`).all() as Array<Omit<FontFaceSummary, 'isVariable' | 'favorite'> & { isVariable: number; favorite: number }>
    // The renderer chooses the configured family-name field for display and deduplication.
    const scoreByFaceId = new Map(scores.map(score => [score.faceId, score.similarity]))
    return rows.flatMap(row => {
      const similarity = scoreByFaceId.get(row.id)
      if (similarity === undefined) return []
      return [{ ...row, isVariable: Boolean(row.isVariable), favorite: Boolean(row.favorite), similarity }]
    }).sort((a, b) => b.similarity - a.similarity || a.id - b.id).slice(0, 120) as SimilarFontFamily[]
  }
  updateUserData(input: { faceId: number; favorite?: boolean; note?: string; language?: string | null; rating?: number }) {
    const current = this.db.prepare('SELECT favorite,note,language,rating FROM font_user_data WHERE face_id=?').get(input.faceId) as { favorite: number; note: string; language: string; rating: number } | undefined
    const favorite = input.favorite === undefined ? current?.favorite ?? 0 : Number(input.favorite)
    const note = input.note === undefined ? current?.note ?? '' : input.note
    const language = input.language === undefined ? current?.language ?? '' : (input.language ?? '')
    const rating = input.rating === undefined ? current?.rating ?? 0 : input.rating
    this.db.prepare('INSERT INTO font_user_data(face_id,favorite,note,language,rating,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(face_id) DO UPDATE SET favorite=excluded.favorite,note=excluded.note,language=excluded.language,rating=excluded.rating,updated_at=excluded.updated_at').run(input.faceId, favorite, note, language, rating, Date.now())
    this.db.prepare('DELETE FROM font_search WHERE face_id=?').run(input.faceId)
    const face = this.db.prepare('SELECT family,subfamily,preferred_family AS preferredFamily,preferred_subfamily AS preferredSubfamily,full_name AS fullName,postscript_name AS postscriptName,localized_search AS localizedSearch FROM font_face WHERE id=?').get(input.faceId) as { family: string; subfamily?: string; preferredFamily?: string; preferredSubfamily?: string; fullName?: string; postscriptName?: string; localizedSearch?: string }
    this.insertSearchRow(input.faceId, face, note)
  }
  updateFamilyNote(faceId: number, note: string) {
    const faces = this.familyFaceIds(faceId)
    if (!faces) throw new Error('找不到该字体。')
    const update = this.db.transaction(() => { for (const face of faces) this.updateUserData({ faceId: face.id, note }) })
    update()
  }
  updateFamilyLanguage(faceId: number, language: string | null) {
    const faces = this.familyFaceIds(faceId)
    if (!faces) throw new Error('找不到该字体。')
    const value = language?.trim() || ''
    const update = this.db.transaction(() => { for (const face of faces) this.updateUserData({ faceId: face.id, language: value }) })
    update()
  }
  private familyRepresentativeId(faceId: number): number | null {
    const row = this.db.prepare(`WITH target AS (
      SELECT COALESCE(NULLIF(preferred_family, ''), family) AS familyName FROM font_face WHERE id=?
    )
    SELECT ff.id FROM font_face ff CROSS JOIN target
    WHERE COALESCE(NULLIF(ff.preferred_family, ''), ff.family)=target.familyName
    ORDER BY
      CASE WHEN LOWER(COALESCE(ff.preferred_subfamily, ff.subfamily, ''))='regular' THEN 0
        WHEN ff.weight BETWEEN 301 AND 450 THEN 1 ELSE 2 END,
      ABS(COALESCE(ff.weight, 400)-400), ff.id
    LIMIT 1`).get(faceId) as { id: number } | undefined
    return row?.id ?? null
  }
  addFamilyLink(sourceFaceId: number, targetFaceId: number) {
    const a = this.familyRepresentativeId(sourceFaceId)
    const b = this.familyRepresentativeId(targetFaceId)
    if (!a || !b) throw new Error('找不到该字体。')
    if (a === b) throw new Error('不能关联同一个字体家族。')
    const now = Date.now()
    const insert = this.db.prepare('INSERT OR IGNORE INTO font_face_link(face_id, target_face_id, created_at) VALUES(?,?,?)')
    const write = this.db.transaction(() => {
      insert.run(a, b, now)
      insert.run(b, a, now)
    })
    write()
  }
  removeFamilyLink(sourceFaceId: number, targetFaceId: number) {
    const a = this.familyRepresentativeId(sourceFaceId)
    const b = this.familyRepresentativeId(targetFaceId)
    if (!a || !b) return
    const del = this.db.prepare('DELETE FROM font_face_link WHERE (face_id=? AND target_face_id=?) OR (face_id=? AND target_face_id=?)')
    const write = this.db.transaction(() => { del.run(a, b, b, a) })
    write()
  }
  listFamilyLinks(faceId: number): FontFaceSummary[] {
    const rep = this.familyRepresentativeId(faceId)
    if (!rep) return []
    const rows = this.db.prepare(`SELECT ff.id, ff.file_id AS fileId, ff.family, ff.subfamily AS subfamily, ff.preferred_family AS preferredFamily, ff.preferred_subfamily AS preferredSubfamily, ff.full_name AS fullName, f.format, ff.postscript_name AS postscriptName, ff.weight AS weight, CAST(ff.is_variable AS INTEGER) AS isVariable, CAST(COALESCE(ud.favorite,0) AS INTEGER) AS favorite
      FROM font_face_link link
      JOIN font_face ff ON ff.id=link.target_face_id
      JOIN font_file f ON f.id=ff.file_id
      JOIN library_root lr ON lr.id=f.root_id
      LEFT JOIN font_user_data ud ON ud.face_id=ff.id
      WHERE link.face_id=? AND f.missing_at IS NULL AND lr.enabled=1 AND lr.visible=1
      ORDER BY COALESCE(NULLIF(ff.preferred_family, ''), ff.family), ff.id`).all(rep) as Array<Omit<FontFaceSummary, 'isVariable' | 'favorite'> & { isVariable: number; favorite: number }>
    return rows.map(row => ({ ...row, isVariable: Boolean(row.isVariable), favorite: Boolean(row.favorite) }))
  }
  previewPath(faceId: number) {
    return this.db.prepare(`SELECT f.path, f.sha256, f.format, f.size, f.mtime_ms AS mtimeMs, ff.face_index AS faceIndex, ff.cmap_ranges AS cmapRanges
      FROM font_face ff JOIN font_file f ON f.id=ff.file_id
      WHERE ff.id=? AND f.missing_at IS NULL`).get(faceId) as {
      path: string
      sha256: string
      format: string | null
      size: number
      mtimeMs: number
      faceIndex: number
      cmapRanges: Buffer | null
    } | undefined
  }

  cmapRanges(faceId: number) {
    const row = this.db.prepare(`SELECT ff.cmap_ranges AS cmapRanges
      FROM font_face ff JOIN font_file f ON f.id=ff.file_id
      WHERE ff.id=? AND f.missing_at IS NULL`).get(faceId) as { cmapRanges: Buffer | null } | undefined
    return row?.cmapRanges ?? null
  }
  resolveActivationTarget(faceId: number, sessionId: string): ActivationTarget | undefined {
    const row = this.db.prepare(`SELECT ff.id AS faceId, f.id AS fileId, f.file_id AS fileIdentity, f.normalized_path AS normalizedPath, f.path, f.sha256
      FROM font_face ff JOIN font_file f ON f.id=ff.file_id
      WHERE ff.id=? AND f.missing_at IS NULL`).get(faceId) as Omit<ActivationTarget, 'sessionId' | 'postscriptNames'> | undefined
    if (!row) return undefined
    const postscriptNames = (this.db.prepare('SELECT postscript_name AS name FROM font_face WHERE file_id=? AND postscript_name IS NOT NULL ORDER BY face_index').all(row.fileId) as Array<{ name: string }>).map(item => item.name)
    return { ...row, sessionId, postscriptNames }
  }
  createActivationSession(input: { id: string; agentPid: number; mainPid: number; platform: string }) {
    this.db.prepare(`INSERT INTO activation_session(id,agent_pid,main_pid,platform,started_at,recovery_state) VALUES(@id,@agentPid,@mainPid,@platform,@startedAt,'open')`).run({ ...input, startedAt: Date.now() })
  }
  markStaleActivationSessionsRecovered() {
    const recover = this.db.transaction(() => {
      const sessions = this.db.prepare("SELECT id FROM activation_session WHERE recovery_state='open'").all() as Array<{ id: string }>
      for (const session of sessions) {
        this.db.prepare("UPDATE activation_record SET state='inactive', owned_ref_count=0, platform_token=NULL, updated_at=? WHERE session_id=?").run(Date.now(), session.id)
        this.db.prepare("UPDATE activation_session SET ended_at=?, recovery_state='recovered', last_error=NULL WHERE id=?").run(Date.now(), session.id)
      }
    })
    recover()
  }
  finishActivationSession(sessionId: string, recoveryState: 'clean' | 'failed', error?: ActivationError) {
    this.db.prepare('UPDATE activation_session SET ended_at=?, recovery_state=?, last_error=? WHERE id=?').run(Date.now(), recoveryState, error ? JSON.stringify(error) : null, sessionId)
  }
  saveActivationRecord(record: ActivationRecord, target: ActivationTarget) {
    this.db.prepare(`INSERT INTO activation_record(session_id,file_id,face_id,path,normalized_path,file_system_id,sha256,platform_token,state,owned_ref_count,last_error,created_at,updated_at)
      VALUES(@sessionId,@fileId,@faceId,@path,@normalizedPath,@fileIdentity,@sha256,@platformToken,@status,@ownedRefCount,@lastError,@updatedAt,@updatedAt)
      ON CONFLICT(session_id,normalized_path) DO UPDATE SET face_id=excluded.face_id,platform_token=excluded.platform_token,state=excluded.state,owned_ref_count=excluded.owned_ref_count,last_error=excluded.last_error,updated_at=excluded.updated_at`).run({
      ...target,
      ...record,
      lastError: record.error ? JSON.stringify(record.error) : null,
    })
  }
  listActivationRecords(sessionId: string): ActivationRecord[] {
    const rows = this.db.prepare(`SELECT ar.session_id AS sessionId, COALESCE(ar.face_id, (SELECT MIN(id) FROM font_face WHERE file_id=ar.file_id)) AS faceId, ar.file_id AS fileId, ar.path, ar.sha256, ar.state AS status, ar.owned_ref_count AS ownedRefCount, ar.platform_token AS platformToken, ar.last_error AS lastError, ar.updated_at AS updatedAt
      FROM activation_record ar WHERE ar.session_id=? ORDER BY ar.id`).all(sessionId) as Array<Omit<ActivationRecord, 'faceIds' | 'error'> & { lastError: string | null }>
    return rows.filter(row => row.faceId && row.fileId).map(row => {
      const faceIds = (this.db.prepare('SELECT id FROM font_face WHERE file_id=? ORDER BY face_index').all(row.fileId) as Array<{ id: number }>).map(item => item.id)
      let error: ActivationError | null = null
      try { error = row.lastError ? JSON.parse(row.lastError) as ActivationError : null } catch { /* Preserve record even if an old error payload is malformed. */ }
      const { lastError: _lastError, ...record } = row
      return { ...record, faceIds: faceIds.length ? faceIds : [row.faceId], error }
    })
  }
  setActivationState(sessionId: string, fileId: number, state: ActivationStatus, error: ActivationError | null = null) {
    this.db.prepare('UPDATE activation_record SET state=?, last_error=?, updated_at=? WHERE session_id=? AND file_id=?').run(state, error ? JSON.stringify(error) : null, Date.now(), sessionId, fileId)
  }
  close() { this.db.close() }
}
