import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '../../../harness-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport } from '../../../harness-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'
import { BridgeHttpServer } from '../../../harness-plugin/lib/server.js'

test('stdio proxy lets Kimi call the authenticated bridge without direct HTTP configuration', async (t) => {
  const bridge = { health: () => ({ ok: true, protocolVersion: 'kimi-dsh-bridge/v1' }) }
  const http = new BridgeHttpServer(bridge, { host: '127.0.0.1', port: 0 }, 'test-token')
  const address = await http.start()
  t.after(() => http.stop())
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['packages/personal/deepseek-subagent/scripts/stdio-proxy.bundle.mjs'],
    env: {
      ...process.env,
      KIMI_DSH_BRIDGE_TOKEN: 'test-token',
      KIMI_DSH_BRIDGE_URL: `http://127.0.0.1:${address.port}/mcp`,
    },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'proxy-test', version: '1.0.0' })
  await client.connect(transport)
  t.after(() => client.close())
  const tools = await client.listTools()
  assert.ok(tools.tools.some((tool) => tool.name === 'ds_delegate'))
  const result = await client.callTool({ name: 'ds_health', arguments: {} })
  assert.equal(result.structuredContent.protocolVersion, 'kimi-dsh-bridge/v1')
})
