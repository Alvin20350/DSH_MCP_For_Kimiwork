import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { BridgeError } from './bridge.js'
import { BRIDGE_VERSION } from './version.js'

const MAX_BODY_BYTES = 1024 * 1024

function json(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

function failure(error) {
  const known = error instanceof BridgeError
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({
        code: known ? error.code : 'BRIDGE_INTERNAL',
        message: error instanceof Error ? error.message : String(error),
        ...(known ? { details: error.details } : {}),
      }, null, 2),
    }],
  }
}

function register(server, name, description, inputSchema, action) {
  server.registerTool(name, { description, inputSchema }, async (input) => {
    try {
      return json(await action(input))
    } catch (error) {
      return failure(error)
    }
  })
}

function mcpFor(bridge) {
  const server = new McpServer({ name: 'dsh-kimi-subagent', version: BRIDGE_VERSION })
  const sessionId = z.string().min(1)
  const prompt = z.string().min(1)
  const requestId = z.string().min(1).optional()
  const cwd = z.string().min(1)

  register(server, 'ds_health', 'Check bridge protocol, Harness compatibility, and capabilities without exposing credentials.', {}, () => bridge.health())
  register(server, 'ds_workspaces', 'List registered Harness workspaces and their last delegated sessions.', {}, () => bridge.workspaces())
  register(server, 'ds_sessions', 'List persistent DSH sessions, optionally restricted to one workspace.', { cwd: cwd.optional() }, (input) => bridge.sessions(input))
  register(server, 'ds_delegate', 'Create or resume a DSH session and delegate a task. Supply a stable requestId for safe retries.', {
    cwd: cwd.optional(),
    sessionId: sessionId.optional(),
    prompt,
    requestId,
    mode: z.enum(['followup', 'steer']).optional(),
  }, (input) => bridge.delegate(input))
  register(server, 'ds_continue', 'Reattach to the last delegated session in a workspace. Without prompt it only reconnects and reports state.', {
    cwd,
    sessionId: sessionId.optional(),
    prompt: prompt.optional(),
    requestId,
  }, (input) => bridge.continueTask(input))
  register(server, 'ds_send', 'Send a followup, steering message, or non-waking context injection to an existing DSH session.', {
    sessionId,
    prompt,
    mode: z.enum(['followup', 'steer', 'inject']).optional(),
    requestId,
  }, (input) => bridge.send(input))
  register(server, 'ds_status', 'Inspect running, interruption, approval, and last-assistant state without starting model work.', { sessionId }, (input) => bridge.status(input))
  register(server, 'ds_result', 'Read the latest committed assistant result and current execution state.', { sessionId }, (input) => bridge.result(input))
  register(server, 'ds_watch', 'Read compact durable events with a resumable cursor; optionally wait up to 20 seconds for new activity.', {
    sessionId,
    consumerId: z.string().min(1).optional(),
    cursor: z.number().int().nonnegative().optional(),
    includeHistory: z.boolean().optional(),
    waitMs: z.number().int().min(0).max(20000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }, (input) => bridge.watch(input))
  register(server, 'ds_cancel', 'Cancel active work while preserving the persistent session and pending inbox.', { sessionId }, (input) => bridge.cancel(input))
  return server
}

function loopbackHostname(value) {
  return ['127.0.0.1', 'localhost', '::1'].includes(value)
}

function trustedRequest(req) {
  try {
    const host = new URL(`http://${req.headers.host}`).hostname
    if (!loopbackHostname(host)) return false
    if (!req.headers.origin) return true
    return loopbackHostname(new URL(req.headers.origin).hostname)
  } catch {
    return false
  }
}

function authorized(req, token) {
  const supplied = req.headers.authorization
  const expected = `Bearer ${token}`
  if (!supplied || supplied.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
}

async function bodyOf(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new BridgeError('BODY_TOO_LARGE', 'MCP request body exceeds 1 MiB')
    chunks.push(chunk)
  }
  if (!chunks.length) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export class BridgeHttpServer {
  constructor(bridge, config, token) {
    this.bridge = bridge
    this.config = config
    this.token = token
    this.transports = new Map()
    this.http = createServer((req, res) => void this.handle(req, res))
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.http.once('error', reject)
      this.http.listen(this.config.port, this.config.host, () => {
        this.http.off('error', reject)
        resolve()
      })
    })
    return this.http.address()
  }

  async stop() {
    for (const transport of this.transports.values()) await transport.close()
    this.transports.clear()
    if (this.http.listening) await new Promise((resolve) => this.http.close(resolve))
  }

  respond(res, status, value) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(value))
  }

  async handle(req, res) {
    try {
      if (!trustedRequest(req)) return this.respond(res, 403, { error: 'forbidden' })
      if (req.url === '/health' && req.method === 'GET') {
        return this.respond(res, this.bridge.health().ok ? 200 : 503, this.bridge.health())
      }
      if (req.url !== '/mcp') return this.respond(res, 404, { error: 'not-found' })
      if (!authorized(req, this.token)) return this.respond(res, 401, { error: 'unauthorized' })

      const sessionId = req.headers['mcp-session-id']
      let transport = sessionId ? this.transports.get(sessionId) : undefined
      const body = req.method === 'POST' ? await bodyOf(req) : undefined
      if (!transport && req.method === 'POST' && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            this.transports.set(id, transport)
          },
        })
        transport.onclose = () => {
          if (transport.sessionId) this.transports.delete(transport.sessionId)
        }
        const server = mcpFor(this.bridge)
        await server.connect(transport)
      }
      if (!transport) return this.respond(res, 400, { error: 'missing-or-invalid-mcp-session' })
      await transport.handleRequest(req, res, body)
    } catch (error) {
      if (!res.headersSent) this.respond(res, 400, failure(error))
      else res.end()
    }
  }
}
