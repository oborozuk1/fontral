import { z } from 'zod'

export const FONT_FORMATS = ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'] as const
export type FontFormat = (typeof FONT_FORMATS)[number]
export const fontFormatSchema = z.enum(FONT_FORMATS)

export const SIMILARITY_MODES = ['family', 'face'] as const
export type SimilarityMode = (typeof SIMILARITY_MODES)[number]
export const similarityModeSchema = z.enum(SIMILARITY_MODES)

export const FONT_LANGUAGES = ['fontLanguage.simplifiedChinese', 'fontLanguage.traditionalChinese', 'fontLanguage.simplifiedAndTraditionalChinese', 'fontLanguage.japanese', 'fontLanguage.korean', 'fontLanguage.latin', 'fontLanguage.other'] as const
export type FontLanguage = (typeof FONT_LANGUAGES)[number]
export const fontLanguageSchema = z.enum(FONT_LANGUAGES)

export const fontQuerySchema = z.object({
  text: z.string().trim().max(200).default(''),
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(2_000).default(500),
  favorite: z.boolean().optional(),
  weightMin: z.number().int().min(100).max(900).optional(),
  weightMax: z.number().int().min(100).max(900).optional(),
  italic: z.boolean().optional(),
  variable: z.boolean().optional(),
  languages: z.array(fontLanguageSchema).max(FONT_LANGUAGES.length).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
  formats: z.array(fontFormatSchema).max(FONT_FORMATS.length).optional(),
  glyphCountMin: z.number().int().min(0).max(1_000_000).optional(),
  glyphCountMax: z.number().int().min(0).max(1_000_000).optional(),
  /** Only faces that contain every character in this string. */
  coversText: z.string().max(1_000).optional(),
  rootId: z.number().int().positive().optional(),
  pathPrefix: z.string().trim().min(1).max(4_096).optional(),
  faceIds: z.array(z.number().int().positive()).max(10_000).optional(),
  excludeFaceIds: z.array(z.number().int().positive()).max(10_000).optional(),
  /** Request a full result count for virtual-scroll extent calculation. */
  includeTotal: z.boolean().optional(),
  /** Return one representative face per family, preferring Regular. */
  groupByFamily: z.boolean().optional(),
})
export type FontQuery = z.input<typeof fontQuerySchema>

export const folderFilterSchema = z.object({
  rootId: z.number().int().positive().optional(),
  pathPrefix: z.string().trim().min(1).max(4_096).optional()
})
export type FolderFilter = z.input<typeof folderFilterSchema>

export interface LibraryFolderNode {
  name: string
  /** Absolute directory path used for filtering (root path or nested folder). */
  path: string
  note: string
  visible: number
  children: LibraryFolderNode[]
}

export interface LibraryRootTree {
  id: number
  path: string
  note: string
  visible: number
  scanStatus: string
  scanProgress?: { processed: number; total: number }
  children: LibraryFolderNode[]
}

export const folderPathSchema = z.string().trim().min(1).max(4_096)

export const faceIdSchema = z.number().int().positive()
export const ACTIVATION_STATUSES = ['inactive', 'activating', 'active', 'deactivating', 'failed', 'already_available', 'conflict'] as const
export const activationStatusSchema = z.enum(ACTIVATION_STATUSES)
export type ActivationStatus = z.infer<typeof activationStatusSchema>

export const ACTIVATION_ERROR_CODES = [
  'file_missing',
  'file_hash_changed',
  'system_already_available',
  'postscript_name_conflict',
  'platform_registration_failed',
  'platform_unregistration_failed',
  'agent_unavailable',
  'agent_auth_failed',
  'agent_timeout',
  'cleanup_failed',
  'unsupported_platform',
] as const
export const activationErrorCodeSchema = z.enum(ACTIVATION_ERROR_CODES)
export type ActivationErrorCode = z.infer<typeof activationErrorCodeSchema>

export const activationErrorSchema = z.object({
  code: activationErrorCodeSchema,
  message: z.string().min(1).max(2_000),
  retryable: z.boolean().default(false),
})
export type ActivationError = z.infer<typeof activationErrorSchema>

export const activationTargetSchema = z.object({
  sessionId: z.string().uuid(),
  faceId: faceIdSchema,
  fileId: z.number().int().positive(),
  fileIdentity: z.string().max(1_000).nullable(),
  normalizedPath: z.string().min(1).max(4_096),
  path: z.string().min(1).max(4_096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  postscriptNames: z.array(z.string().min(1).max(500)).max(256),
})
export type ActivationTarget = z.infer<typeof activationTargetSchema>

export const activationRecordSchema = z.object({
  sessionId: z.string().uuid(),
  faceId: faceIdSchema,
  fileId: z.number().int().positive(),
  faceIds: z.array(faceIdSchema).min(1).max(256),
  path: z.string().min(1).max(4_096),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  status: activationStatusSchema,
  ownedRefCount: z.number().int().min(0),
  platformToken: z.string().max(4_096).nullable(),
  error: activationErrorSchema.nullable(),
  updatedAt: z.number().int().nonnegative(),
})
export type ActivationRecord = z.infer<typeof activationRecordSchema>

export const activationCommandSchema = z.enum(['handshake', 'activate', 'launchIsolated', 'deactivate', 'deactivateAll', 'list', 'shutdown'])
export type ActivationCommand = z.infer<typeof activationCommandSchema>
export const activationAgentRequestSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(32).max(512),
  command: activationCommandSchema,
  target: activationTargetSchema.optional(),
  fileId: z.number().int().positive().optional(),
  executable: z.string().min(1).max(4_096).optional(),
})
export type ActivationAgentRequest = z.infer<typeof activationAgentRequestSchema>
export const activationAgentResponseSchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  record: activationRecordSchema.optional(),
  records: z.array(activationRecordSchema).optional(),
  error: activationErrorSchema.optional(),
})
export type ActivationAgentResponse = z.infer<typeof activationAgentResponseSchema>
export const fontFamilySchema = z.string().trim().min(1).max(500)
export const userDataSchema = z.object({
  faceId: faceIdSchema,
  favorite: z.boolean().optional(),
  note: z.string().max(2_000).optional(),
  rating: z.number().int().min(0).max(5).optional()
})
export const TAG_NAME_MAX = 32
export const FAMILY_TAGS_MAX = 20
export const tagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAX)
export const familyTagsSchema = z.array(tagNameSchema).max(FAMILY_TAGS_MAX)
export const rootIdSchema = z.number().int().positive()

export interface FontFaceSummary {
  id: number
  fileId: number
  family: string
  subfamily: string | null
  preferredFamily: string | null
  preferredSubfamily: string | null
  fullName: string | null
  format: string | null
  postscriptName: string | null
  weight: number | null
  isVariable: boolean
  favorite: boolean
}

export interface SimilarFontFamily extends FontFaceSummary {
  /** Visual similarity, where 100 means identical extracted signatures. */
  similarity: number
}

export interface FontAxis {
  tag: string
  name: string
  min: number
  default: number
  max: number
}

export interface FontLocalizedName {
  type: string
  language: string
  value: string
}

export interface UnicodeBlockCoverage {
  name: string
  range: string
  codePointCount: number
  blockTotal: number
}

export type CjkCoverageGroup = string

export interface CjkCoverageItem {
  id: string
  name: string
  group: CjkCoverageGroup
  codePointCount: number
  total: number
}

export interface CharsetCharItem {
  codePoint: number
  char: string
  name: string
  inFont: boolean
}

export interface CharsetCharsResult {
  title: string
  total: number
  covered: number
  page: number
  pageSize: number
  pageCount: number
  chars: CharsetCharItem[]
}

export const CHARSET_PAGE_SIZE_DEFAULT = 300
export const charsetCharsQuerySchema = z.object({
  faceId: faceIdSchema,
  source: z.enum(['unicode', 'cjk']),
  key: z.string().trim().min(1).max(200),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(50).max(1_000).default(CHARSET_PAGE_SIZE_DEFAULT),
  onlyInFont: z.boolean().default(false),
})
export type CharsetCharsQuery = z.input<typeof charsetCharsQuerySchema>

export interface FontMetrics {
  weight: number | null
  widthClass: number | null
  isBold: boolean | null
  isItalic: boolean | null
  isOblique: boolean | null
  isRegular: boolean | null
  italicAngle: number | null
  unitsPerEm: number | null
  ascent: number | null
  descent: number | null
  lineGap: number | null
  typoAscender: number | null
  typoDescender: number | null
  typoLineGap: number | null
  winAscent: number | null
  winDescent: number | null
  capHeight: number | null
  xHeight: number | null
  underlinePosition: number | null
  underlineThickness: number | null
  strikeoutPosition: number | null
  strikeoutSize: number | null
  avgCharWidth: number | null
  bboxMinX: number | null
  bboxMinY: number | null
  bboxMaxX: number | null
  bboxMaxY: number | null
}

export interface FontCreditInfo {
  copyright: string | null
  trademark: string | null
  manufacturer: string | null
  designer: string | null
  description: string | null
  vendorURL: string | null
  designerURL: string | null
  license: string | null
  licenseURL: string | null
  version: string | null
  vendorID: string | null
  sampleText: string | null
}

export interface OpenTypeFeature {
  tag: string
  name: string
}

export interface FontFaceDetail extends FontFaceSummary {
  axes: FontAxis[]
  glyphCount: number | null
  path: string
  fileSize: number
  /** File mtime (ms since epoch). */
  modifiedAt: number
  note: string
  tags: string[]
  /** User-selected language; falls back to inferredLanguage when empty. */
  language: FontLanguage | null
  localizedNames: FontLocalizedName[]
  unicodeBlocks: UnicodeBlockCoverage[]
  cjkCoverage: CjkCoverageItem[]
  cjkCharacterCount: number
  inferredLanguage: FontLanguage | null
  metrics: FontMetrics
  credits: FontCreditInfo
  openTypeFeatures: OpenTypeFeature[]
}

export interface FontPage {
  items: FontFaceSummary[]
  /** Total faces matching the query, independent of the current cursor page. */
  total?: number
  nextCursor?: number
}

export interface FontralApi {
  app: {
    getVersion(): Promise<string>
    openExternal(url: string): Promise<void>
  }
  fonts: {
    query(input: FontQuery): Promise<FontPage>
    family(family: string, filter?: FolderFilter): Promise<FontFaceSummary[]>
    similar(faceId: number, mode?: SimilarityMode): Promise<SimilarFontFamily[]>
    details(id: number): Promise<FontFaceDetail | null>
    charsetChars(input: CharsetCharsQuery): Promise<CharsetCharsResult>
    previewText(faceId: number, text: string): Promise<string>
    updateUserData(input: z.input<typeof userDataSchema>): Promise<void>
    updateFamilyNote(faceId: number, note: string): Promise<void>
    updateFamilyLanguage(faceId: number, language: FontLanguage | null): Promise<void>
    listFamilyLinks(faceId: number): Promise<FontFaceSummary[]>
    addFamilyLink(faceId: number, targetFaceId: number): Promise<void>
    removeFamilyLink(faceId: number, targetFaceId: number): Promise<void>
    listTags(): Promise<string[]>
    updateFamilyTags(faceId: number, tags: string[]): Promise<void>
    openFile(faceId: number): Promise<void>
    revealInFolder(faceId: number): Promise<void>
    clearPreviewCache(): Promise<void>
  }
  library: {
    addRoot(): Promise<number | null>
    rescan(rootId: number, path?: string): Promise<void>
    rebuildDatabase(): Promise<void>
    removeRoot(rootId: number): Promise<void>
    listRoots(): Promise<LibraryRootTree[]>
    updateRootNote(rootId: number, note: string): Promise<void>
    updateFolderNote(rootId: number, path: string, note: string): Promise<void>
    updateRootVisible(rootId: number, visible: boolean): Promise<void>
    updateFolderVisible(rootId: number, path: string, visible: boolean): Promise<void>
    openFolder(path: string): Promise<void>
  }
  window: {
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    confirmClose(action?: 'quit' | 'tray'): Promise<void>
    setMinimizeToTray(enabled: boolean): Promise<void>
    reloadApp(): Promise<void>
  }
  activation: {
    activate(faceId: number): Promise<ActivationRecord>
    deactivate(faceId: number): Promise<ActivationRecord>
    list(): Promise<ActivationRecord[]>
  }
}
