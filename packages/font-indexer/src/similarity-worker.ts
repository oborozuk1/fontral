import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import * as fontkit from 'fontkit'

// Each glyph is normalized independently so the signature describes construction,
// terminals and counter shapes rather than a font's overall metrics alone.
// Mixed Latin/digit/CJK coverage so a Latin-only font is not rewarded for matching
// the all-zero CJK columns of another Latin-only font.
const SAMPLES = 'AaEeGgRr0129永国中水月好森'
const GRID = 20
// 4x4 sub-sampling per cell turns the silhouette into a soft [0,1] occupancy map,
// which makes fuzzy IoU sensitive to weight and stroke thickness differences.
const SUB = 4
const CELL_PIXELS = GRID * GRID
const CHAR_CELL_COUNT = SAMPLES.length * CELL_PIXELS

type Point = [number, number]

function flattenPath(commands: Array<{ command: string; args?: number[] }>) {
  const contours: Point[][] = []
  let contour: Point[] | undefined
  let current: Point = [0, 0]
  for (const item of commands) {
    const args = item.args ?? []
    if (item.command === 'moveTo') {
      contour = [[args[0]!, args[1]!]]
      contours.push(contour)
      current = contour[0]!
    } else if (item.command === 'lineTo' && contour) {
      current = [args[0]!, args[1]!]
      contour.push(current)
    } else if (item.command === 'quadraticCurveTo' && contour) {
      const [cx, cy, x, y] = args
      const start = current
      for (let step = 1; step <= 6; step += 1) {
        const t = step / 6
        contour.push([
          (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * cx! + t ** 2 * x!,
          (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * cy! + t ** 2 * y!,
        ])
      }
      current = [x!, y!]
    } else if (item.command === 'bezierCurveTo' && contour) {
      const [cx1, cy1, cx2, cy2, x, y] = args
      const start = current
      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8
        contour.push([
          (1 - t) ** 3 * start[0] + 3 * (1 - t) ** 2 * t * cx1! + 3 * (1 - t) * t ** 2 * cx2! + t ** 3 * x!,
          (1 - t) ** 3 * start[1] + 3 * (1 - t) ** 2 * t * cy1! + 3 * (1 - t) * t ** 2 * cy2! + t ** 3 * y!,
        ])
      }
      current = [x!, y!]
    }
  }
  return contours.filter(contour => contour.length >= 3)
}

function inside(point: Point, contours: Point[][]) {
  let hit = false
  for (const contour of contours) {
    for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
      const a = contour[index]!
      const b = contour[previous]!
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit
    }
  }
  return hit
}

// Anti-aliased occupancy for one cell: average of SUB*SUB sub-samples spread across the cell.
function cellCoverage(x: number, y: number, contours: Point[][]) {
  let hits = 0
  const samples = SUB * SUB
  for (let sy = 0; sy < SUB; sy += 1) {
    for (let sx = 0; sx < SUB; sx += 1) {
      if (inside([x + (sx + 0.5) / SUB, y + (sy + 0.5) / SUB], contours)) hits += 1
    }
  }
  return hits / samples
}

function glyphSignature(glyph: any): { valid: boolean; aspect: number; cells: number[] } {
  const empty = { valid: false, aspect: 0, cells: Array<number>(CELL_PIXELS).fill(0) }
  if (!glyph || glyph.id === 0 || !glyph.bbox) return empty
  const contours = flattenPath(glyph.path?.commands ?? [])
  if (!contours.length) return empty
  const box = glyph.bbox
  const width = Math.max(1, box.maxX - box.minX)
  const height = Math.max(1, box.maxY - box.minY)
  const scale = (GRID - 2) / Math.max(width, height)
  const offsetX = (GRID - width * scale) / 2 - box.minX * scale
  const offsetY = (GRID - height * scale) / 2 - box.minY * scale
  const normalized = contours.map(contour => contour.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY] as Point))
  const cells: number[] = new Array(CELL_PIXELS)
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      cells[y * GRID + x] = cellCoverage(x, y, normalized)
    }
  }
  return { valid: true, aspect: Math.min(2, width / height) / 2, cells }
}

async function main() {
  const bytes = await readFile(workerData.path)
  const collection: any = fontkit.create(bytes)
  const font = 'fonts' in collection ? collection.fonts[workerData.faceIndex] : collection
  if (!font) throw new Error('找不到字体 face。')
  const valid: number[] = []
  const aspects: number[] = []
  const cells: number[] = new Array(CHAR_CELL_COUNT)
  let offset = 0
  for (const char of SAMPLES) {
    const sig = glyphSignature(font.glyphForCodePoint(char.codePointAt(0)!))
    valid.push(sig.valid ? 1 : 0)
    aspects.push(sig.aspect)
    for (let i = 0; i < CELL_PIXELS; i += 1) cells[offset + i] = sig.cells[i]!
    offset += CELL_PIXELS
  }
  parentPort?.postMessage({ type: 'feature', faceId: workerData.faceId, signature: { v: 3, valid, aspects, cells } })
}

main().catch(error => parentPort?.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) }))
