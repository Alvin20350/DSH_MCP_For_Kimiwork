import { spawnSync } from 'node:child_process'
import { Client } from '../packages/harness-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../packages/harness-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'

function token() {
  if (process.env.KIMI_DSH_BRIDGE_TOKEN) return process.env.KIMI_DSH_BRIDGE_TOKEN
  if (process.platform !== 'win32') throw new Error('KIMI_DSH_BRIDGE_TOKEN is not set')
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::GetEnvironmentVariable('KIMI_DSH_BRIDGE_TOKEN','User')",
  ], { encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.trim()) throw new Error('Bridge token is unavailable')
  return result.stdout.trim()
}

const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:37841/mcp'), {
  requestInit: { headers: { Authorization: `Bearer ${token()}` } },
})
const client = new Client({ name: 'desktop-check', version: '1.0.0' })
await client.connect(transport)

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed`)
  return result.structuredContent
}

try {
  const health = await call('ds_health')
  const workspaces = await call('ds_workspaces')
  console.log(JSON.stringify({ health, workspaces }, null, 2))

  const delegateIndex = process.argv.indexOf('--delegate')
  if (delegateIndex >= 0) {
    const cwd = process.argv[delegateIndex + 1]
    if (!cwd) throw new Error('--delegate requires an absolute cwd')
    const delegated = await call('ds_delegate', {
      cwd,
      prompt: '这是 Kimi 到 DeepSeek Harness 的最小联通测试。不要调用工具，不要修改文件，只回复 DS_DELEGATE_OK。',
      requestId: `desktop-check-${Date.now()}`,
    })
    console.log(`DELEGATED ${delegated.sessionId}`)
    const grouped = await call('ds_workspaces')
    if (!grouped.items.some((item) => item.sessionIds.includes(delegated.sessionId))) {
      throw new Error('DS session is still ungrouped')
    }
    console.log('WORKSPACE_GROUP_OK')
    let result
    for (let attempt = 0; attempt < 60; attempt += 1) {
      result = await call('ds_result', { sessionId: delegated.sessionId })
      if (result.result?.text && !result.running) break
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    if (!result?.result?.text) throw new Error('DS task did not produce a final result')
    console.log(`RESULT ${result.result.text}`)
    const continued = await call('ds_continue', { cwd })
    if (continued.sessionId !== delegated.sessionId) throw new Error('continue selected a different session')
    console.log(`CONTINUE_OK ${continued.sessionId}`)
  }
} finally {
  await client.close()
}
