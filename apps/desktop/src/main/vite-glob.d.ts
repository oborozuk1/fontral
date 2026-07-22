declare interface ImportMeta {
  glob<T = unknown>(pattern: string, options?: { eager?: boolean; import?: 'default' | 'raw' | 'url'; query?: string; exhaustive?: boolean }): Record<string, T>
  readonly env: Record<string, string | undefined>
}
