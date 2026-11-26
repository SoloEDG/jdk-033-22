import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'

await mkdir('node_modules/.cache', { recursive: true })
await build({
  entryPoints: ['scripts/verify-encounters.ts', 'scripts/smoke-partner.ts'],
  outdir: 'node_modules/.cache',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
})
await import('../node_modules/.cache/verify-encounters.mjs')
await import('../node_modules/.cache/smoke-partner.mjs')
