declare module 'subset-font' {
  type TargetFormat = 'sfnt' | 'truetype' | 'woff' | 'woff2'
  type SubsetOptions = {
    targetFormat?: TargetFormat
    preserveNameIds?: number[]
    variationAxes?: Record<string, number | { min?: number; max?: number; default?: number }>
    noLayoutClosure?: boolean
  }
  export default function subsetFont(
    originalFont: Buffer | Uint8Array,
    text: string,
    options?: SubsetOptions,
  ): Promise<Buffer>
}
