import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

function bridgeToken() {
  if (process.env.KIMI_DSH_BRIDGE_TOKEN) return process.env.KIMI_DSH_BRIDGE_TOKEN
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "[Environment]::GetEnvironmentVariable('KIMI_DSH_BRIDGE_TOKEN','User')",
    ], { encoding: 'utf8', windowsHide: true })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('launchctl', ['getenv', 'KIMI_DSH_BRIDGE_TOKEN'], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  throw new Error('KIMI_DSH_BRIDGE_TOKEN is unavailable in process and GUI user environments')
}

const token = bridgeToken()
const url = process.env.KIMI_DSH_BRIDGE_URL ?? 'http://127.0.0.1:37841/mcp'
const upstream = new Client({ name: 'kimi-dsh-stdio-proxy', version: '0.1.2' })
const http = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
})
await upstream.connect(http)

const server = new Server(
  { name: 'deepseek-subagent-stdio', version: '0.1.2' },
  { capabilities: { tools: {} } },
)
server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools())
server.setRequestHandler(CallToolRequestSchema, (request) => upstream.callTool(request.params))
await server.connect(new StdioServerTransport())

async function shutdown() {
  await Promise.allSettled([server.close(), upstream.close()])
  process.exit(0)
}
process.stdin.on('close', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
