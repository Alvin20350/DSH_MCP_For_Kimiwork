import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const required = [
  'AGENTS.md',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'skills/dsh-subagent-installer/SKILL.md',
  'scripts/install.mjs',
  'scripts/doctor.mjs',
  'packages/harness-plugin/index.js',
  'packages/harness-plugin/package-lock.json',
  'packages/personal/deepseek-subagent/kimi.plugin.json',
  'packages/kimi-code/mcp.json',
]

for (const path of required) {
  const content = await readFile(join(root, path), 'utf8')
  assert.ok(content.trim().length > 0, `${path} is empty`)
  assert.ok(!content.includes('TODO_'), `${path} contains an unfinished marker`)
}

for (const path of required.filter((name) => name.endsWith('.json'))) {
  JSON.parse(await readFile(join(root, path), 'utf8'))
}

const plugin = JSON.parse(await readFile(join(root, 'packages/personal/deepseek-subagent/kimi.plugin.json'), 'utf8'))
assert.equal(plugin.mcpServers['deepseek-subagent'].command, 'node')
assert.deepEqual(plugin.mcpServers['deepseek-subagent'].args, ['./scripts/stdio-proxy.bundle.mjs'])
assert.equal(plugin.sessionStart.skill, 'deepseek-subagent')
assert.ok((await readFile(join(root, 'packages/personal/deepseek-subagent/scripts/stdio-proxy.bundle.mjs'), 'utf8')).length > 1000)
assert.ok((await readFile(join(root, 'packages/kimi-code/stdio-proxy.bundle.mjs'), 'utf8')).length > 1000)

const harness = JSON.parse(await readFile(join(root, 'packages/harness-plugin/package.json'), 'utf8'))
assert.ok(harness.dependencies['@modelcontextprotocol/sdk'])
assert.ok(harness.dsh.bundle.patch)

const files = await readdir(root, { recursive: true, withFileTypes: true })
const secrets = files.filter((entry) => entry.isFile() && /^\.env(?:\..+)?$/.test(entry.name))
assert.deepEqual(secrets.map((entry) => entry.name), [], 'Environment secret files must not be committed')
console.log(`Repository contract OK (${required.length} required files)`)
