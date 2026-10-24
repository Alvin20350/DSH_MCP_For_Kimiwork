import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { BridgeHttpServer } from '../lib/server.js'

test('MCP endpoint enforces authentication and exposes versioned tools', async (t) => {
  const bridge = {
    health: () => ({ ok: true, protocolVersion: 'kimi-dsh-bridge/v1', capabilities: ['delegate'] }),
  }
  const server = new BridgeHttpServer(bridge, { host: '127.0.0.1', port: 0 }, 'test-token')
  const address = await server.start()
  const url = `http://127.0.0.1:${address.port}`
  t.after(() => server.stop())

  const health = await fetch(`${url}/health`)
  assert.equal(health.status, 200)
  const unauthorized = await fetch(`${url}/mcp`, { method: 'POST' })
  assert.equal(unauthorized.status, 401)

  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer test-token' } },
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(transport)
  t.after(() => client.close())
  const tools = await client.listTools()
  assert.ok(tools.tools.some((tool) => tool.name === 'ds_delegate'))
  const result = await client.callTool({ name: 'ds_health', arguments: {} })
  assert.equal(result.structuredContent.protocolVersion, 'kimi-dsh-bridge/v1')
})
