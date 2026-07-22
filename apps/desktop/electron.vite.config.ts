import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@fontral/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      '@fontral/database': fileURLToPath(new URL('../../packages/database/src/index.ts', import.meta.url)),
      '@fontral/font-indexer': fileURLToPath(new URL('../../packages/font-indexer/src/index.ts', import.meta.url)),
      '@fontral/activation-client': fileURLToPath(new URL('../../packages/activation-client/src/index.ts', import.meta.url)),
    },
  },
  main: { build: { externalizeDeps: { exclude: ['@fontral/activation-client', '@fontral/contracts', '@fontral/database', '@fontral/font-indexer'] }, rollupOptions: { input: { index: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)), 'font-scan-worker': fileURLToPath(new URL('../../packages/font-indexer/src/worker.ts', import.meta.url)), 'font-similarity-worker': fileURLToPath(new URL('../../packages/font-indexer/src/similarity-worker.ts', import.meta.url)), 'preview-subset-worker': fileURLToPath(new URL('./src/main/preview-subset-worker.ts', import.meta.url)), 'activation-agent': fileURLToPath(new URL('../../native/activation-agent/src/index.ts', import.meta.url)) }, external: ['better-sqlite3', 'fontkit', 'subset-font'] } } },
  preload: { build: { rollupOptions: { external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: {
    publicDir: fileURLToPath(new URL('./resources', import.meta.url)),
    plugins: [vue()],
  }
})
