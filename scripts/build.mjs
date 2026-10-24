import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const entry = resolve(root, 'packages/personal/deepseek-subagent/scripts/stdio-proxy.mjs')
for (const outfile of [
  resolve(root, 'packages/personal/deepseek-subagent/scripts/stdio-proxy.bundle.mjs'),
  resolve(root, 'packages/kimi-code/stdio-proxy.bundle.mjs'),
]) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    nodePaths: [resolve(root, 'packages/harness-plugin/node_modules')],
    sourcemap: false,
    minify: true,
    logLevel: 'info',
  })
}
