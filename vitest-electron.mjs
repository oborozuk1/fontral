import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const desktopRequire = createRequire(resolve('apps/desktop/package.json'))
const electron = desktopRequire('electron')
const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs')
const result = spawnSync(electron, [vitest, 'run'], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
