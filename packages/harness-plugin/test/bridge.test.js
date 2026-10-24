import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { HarnessBridge } from '../lib/bridge.js'
import { BridgeStore } from '../lib/store.js'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'kimi-dsh-bridge-'))
  const cwd = await realpath(directory)
  const sessions = new Map()
  const prompts = []
  const listeners = []
  const workspace = { id: 'w1', path: cwd, title: 'test', sessionIds: [] }
  const ctx = {
    on: (...args) => listeners.push(args),
    agents: { get: (id) => sessions.get(id)?.agent },
    workspaceRegistry: {
      list: () => [workspace],
      create: async () => workspace,
    },
    sessionQuery: {
      listSessions: async () => [...sessions.values()].map((entry) => ({
        header: entry.session.header,
        live: true,
        persisted: true,
        formatStatus: 'current',
      })),
      observeSession: async (id) => {
        const entry = sessions.get(id)
        if (!entry) throw new Error(`missing ${id}`)
        return {
          header: entry.session.header,
          events: entry.events,
          [Symbol.dispose]: () => {},
        }
      },
    },
    sessionController: {
      commands: {
        create: async ({ workspaceId }) => {
          assert.equal(workspaceId, workspace.id)
          const sessionId = `session-${sessions.size + 1}`
          const session = { id: sessionId, header: { id: sessionId, cwd: workspace.path, createdAt: new Date().toISOString() } }
          const agent = {
            id: sessionId,
            status: 'idle',
            session,
            inject: (message) => entry.events.push({ seq: entry.events.length, type: 'user/message', data: { message } }),
          }
          const entry = { session, agent, events: [] }
          sessions.set(sessionId, entry)
          workspace.sessionIds.unshift(sessionId)
          return { sessionId }
        },
        resolveAgent: async (id) => sessions.get(id)?.agent,
        prompt: async (request, source) => {
          prompts.push({ request, source })
          const entry = sessions.get(request.sessionId)
          entry.events.push({
            seq: entry.events.length,
            type: 'user/message',
            data: { message: { content: request.content, source } },
          })
          return { accepted: true }
        },
        cancel: ({ sessionId }) => ({ accepted: true, sessionId }),
      },
    },
  }
  const store = await new BridgeStore(join(directory, 'state.json')).load()
  const bridge = new HarnessBridge(ctx, { allowedRoots: [], allowUntestedHarness: false }, store)
  return { bridge, ctx, sessions, prompts, directory, store }
}

test('delegation is idempotent and continuation reuses the same durable session', async (t) => {
  const f = await fixture()
  t.after(() => rm(f.directory, { recursive: true, force: true }))
  const first = await f.bridge.delegate({ cwd: f.directory, prompt: 'inspect', requestId: 'stable-1' })
  const retry = await f.bridge.delegate({ cwd: f.directory, prompt: 'inspect', requestId: 'stable-1' })
  assert.equal(first.sessionId, retry.sessionId)
  assert.equal(f.sessions.size, 1)
  assert.ok(f.ctx.workspaceRegistry.list()[0].sessionIds.includes(first.sessionId))
  assert.equal(f.prompts.length, 2)
  const continued = await f.bridge.continueTask({ cwd: f.directory })
  assert.equal(continued.sessionId, first.sessionId)
  assert.equal(continued.resumedWithoutPrompt, true)
  const page = await f.bridge.watch({ sessionId: first.sessionId, includeHistory: true })
  assert.equal(page.events.length, 2)
  assert.equal(page.cursor, 2)
})
