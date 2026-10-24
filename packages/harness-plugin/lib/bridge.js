import { createHash, randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { compactEvent, lastTurnState, latestAssistantText, pendingApprovals } from './events.js'
import { BRIDGE_VERSION, PROTOCOL_VERSION, compatibility } from './version.js'

export class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
    this.details = details
  }
}

function promptDigest(prompt) {
  return createHash('sha256').update(prompt).digest('hex')
}

function requestId(value) {
  return value || `kimi-${randomUUID()}`
}

function contains(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export class HarnessBridge {
  constructor(ctx, config, store) {
    this.ctx = ctx
    this.config = config
    this.store = store
    this.waiters = new Set()
    ctx.on('session/event', (_session, _event) => this.notify())
  }

  notify() {
    for (const wake of this.waiters) wake()
    this.waiters.clear()
  }

  close() {
    this.notify()
  }

  health() {
    const compat = compatibility(undefined, this.config.allowUntestedHarness)
    return {
      ok: compat.allowed,
      protocolVersion: PROTOCOL_VERSION,
      bridgeVersion: BRIDGE_VERSION,
      ...compat,
      capabilities: [
        'workspaces',
        'persistent-sessions',
        'delegate',
        'continue',
        'followup',
        'steer',
        'inject',
        'watch',
        'cancel',
        'durable-cursors',
        'idempotent-requests',
      ],
    }
  }

  async canonicalCwd(value) {
    if (!value || typeof value !== 'string') {
      throw new BridgeError('CWD_REQUIRED', 'An absolute workspace cwd is required')
    }
    try {
      return await realpath(value)
    } catch (error) {
      throw new BridgeError('CWD_UNAVAILABLE', `Workspace is unavailable: ${value}`, {
        reason: String(error),
      })
    }
  }

  async workspaceFor(cwd) {
    const existing = this.ctx.workspaceRegistry.list().find((workspace) => workspace.path === cwd)
    if (existing) return existing
    for (const configuredRoot of this.config.allowedRoots) {
      let root
      try {
        root = await realpath(configuredRoot)
      } catch {
        continue
      }
      if (contains(root, cwd)) {
        return this.ctx.workspaceRegistry.create(cwd, basename(cwd) || cwd)
      }
    }
    throw new BridgeError(
      'WORKSPACE_NOT_ALLOWED',
      `No registered Harness workspace matches ${cwd}; register it in Harness or configure an allowed root`,
      { cwd },
    )
  }

  async observe(sessionId, reader) {
    const observation = await this.ctx.sessionQuery.observeSession(sessionId)
    try {
      return await reader(observation)
    } finally {
      observation[Symbol.dispose]?.()
    }
  }

  async agent(sessionId) {
    try {
      return await this.ctx.sessionController.commands.resolveAgent(sessionId)
    } catch (error) {
      throw new BridgeError('SESSION_UNAVAILABLE', `Cannot resume session ${sessionId}`, {
        reason: String(error),
      })
    }
  }

  async assertSessionCwd(sessionId, cwd) {
    const agent = await this.agent(sessionId)
    const actual = agent.session.header.cwd
    if (actual && (await this.canonicalCwd(actual)) !== cwd) {
      throw new BridgeError('SESSION_CWD_CONFLICT', `Session ${sessionId} belongs to ${actual}, not ${cwd}`)
    }
    return agent
  }

  workspaces() {
    return {
      items: this.ctx.workspaceRegistry.list().map((workspace) => ({
        workspaceId: workspace.id,
        title: workspace.title,
        cwd: workspace.path,
        sessionIds: workspace.sessionIds,
        lastSessionId: this.store.lastSession(workspace.path),
      })),
    }
  }

  async sessions({ cwd } = {}) {
    const canonical = cwd ? await this.canonicalCwd(cwd) : undefined
    const records = await this.ctx.sessionQuery.listSessions()
    return {
      items: records
        .filter((record) => !canonical || record.header.cwd === canonical)
        .map((record) => ({
          sessionId: record.header.id,
          cwd: record.header.cwd,
          createdAt: record.header.createdAt,
          live: record.live,
          persisted: record.persisted,
          formatStatus: record.formatStatus,
          lastDelegated: this.store.lastSession(record.header.cwd) === record.header.id,
        })),
    }
  }

  async status({ sessionId }) {
    if (!sessionId) throw new BridgeError('SESSION_REQUIRED', 'sessionId is required')
    return this.observe(sessionId, async ({ header, events }) => {
      const agent = this.ctx.agents.get(sessionId)
      return {
        sessionId,
        cwd: header.cwd,
        attached: Boolean(agent),
        running: agent?.status === 'running',
        agentStatus: agent?.status ?? 'detached',
        eventCursor: events.at(-1)?.seq + 1 || 0,
        turn: lastTurnState(events),
        pendingApprovals: pendingApprovals(events),
        lastAssistant: latestAssistantText(events, 1000),
      }
    })
  }

  async delegate({ cwd, sessionId, prompt, requestId: suppliedRequestId, mode = 'followup' }) {
    if (!prompt?.trim()) throw new BridgeError('PROMPT_REQUIRED', 'prompt is required')
    if (!['followup', 'steer'].includes(mode)) throw new BridgeError('MODE_INVALID', 'delegate mode must be followup or steer')
    const id = requestId(suppliedRequestId)
    const hash = promptDigest(prompt)
    const previous = this.store.request(id)
    if (previous?.promptHash && previous.promptHash !== hash) {
      throw new BridgeError('REQUEST_CONFLICT', `requestId ${id} was already used for different prompt content`)
    }
    const canonical = await this.canonicalCwd(cwd ?? previous?.cwd)
    let resolvedSession = previous?.sessionId ?? sessionId
    if (resolvedSession) {
      await this.assertSessionCwd(resolvedSession, canonical)
    } else {
      const workspace = await this.workspaceFor(canonical)
      resolvedSession = (await this.ctx.sessionController.commands.create({ workspaceId: workspace.id })).sessionId
    }
    await this.store.bindRequest({
      requestId: id,
      sessionId: resolvedSession,
      cwd: canonical,
      promptHash: hash,
    })
    await this.ctx.sessionController.commands.prompt(
      {
        requestId: id,
        sessionId: resolvedSession,
        mode,
        content: [{ type: 'text', text: prompt }],
      },
      { kind: 'user', rpcId: id },
    )
    return {
      accepted: true,
      requestId: id,
      sessionId: resolvedSession,
      cwd: canonical,
      reusedRequest: Boolean(previous),
      ...(await this.status({ sessionId: resolvedSession })),
    }
  }

  async continueTask({ cwd, sessionId, prompt, requestId: suppliedRequestId }) {
    const canonical = await this.canonicalCwd(cwd)
    const resolvedSession = sessionId ?? this.store.lastSession(canonical)
    if (!resolvedSession) {
      throw new BridgeError('NO_PREVIOUS_SESSION', `No delegated session is recorded for ${canonical}`)
    }
    await this.assertSessionCwd(resolvedSession, canonical)
    if (!prompt?.trim()) {
      return { attached: true, resumedWithoutPrompt: true, ...(await this.status({ sessionId: resolvedSession })) }
    }
    return this.delegate({
      cwd: canonical,
      sessionId: resolvedSession,
      prompt,
      requestId: requestId(suppliedRequestId),
    })
  }

  async send({ sessionId, prompt, mode = 'followup', requestId: suppliedRequestId }) {
    if (!['followup', 'steer', 'inject'].includes(mode)) {
      throw new BridgeError('MODE_INVALID', 'mode must be followup, steer, or inject')
    }
    if (!prompt?.trim()) throw new BridgeError('PROMPT_REQUIRED', 'prompt is required')
    const agent = await this.agent(sessionId)
    const cwd = await this.canonicalCwd(agent.session.header.cwd)
    if (mode === 'inject') {
      const id = requestId(suppliedRequestId)
      const hash = promptDigest(`${mode}:${prompt}`)
      const previous = this.store.request(id)
      if (previous?.promptHash && previous.promptHash !== hash) {
        throw new BridgeError('REQUEST_CONFLICT', `requestId ${id} was already used for different content`)
      }
      if (!previous) {
        agent.inject({ content: [{ type: 'text', text: prompt }], source: { kind: 'user', rpcId: id } })
        await this.store.bindRequest({ requestId: id, sessionId, cwd, promptHash: hash })
      }
      return { accepted: true, requestId: id, sessionId, mode, reusedRequest: Boolean(previous) }
    }
    return this.delegate({ cwd, sessionId, prompt, mode, requestId: suppliedRequestId })
  }

  async cancel({ sessionId }) {
    await this.agent(sessionId)
    this.ctx.sessionController.commands.cancel({ sessionId })
    return { accepted: true, sessionId }
  }

  async result({ sessionId }) {
    const base = await this.status({ sessionId })
    return this.observe(sessionId, async ({ events }) => ({
      ...base,
      result: latestAssistantText(events, 12000),
    }))
  }

  async watch({ sessionId, consumerId = 'default', cursor, includeHistory = false, waitMs = 0, limit = 50 }) {
    const storedCursor = this.store.cursor(consumerId, sessionId)
    let effectiveCursor = cursor ?? storedCursor
    if (effectiveCursor === undefined && !includeHistory) {
      effectiveCursor = (await this.status({ sessionId })).eventCursor
    }
    effectiveCursor ??= 0
    const read = () => this.observe(sessionId, async ({ events }) => {
      const selected = events.filter((event) => event.seq >= effectiveCursor)
      const page = selected.slice(0, limit)
      return {
        sessionId,
        events: page.map((event) => compactEvent(event)),
        cursor: page.length ? page.at(-1).seq + 1 : effectiveCursor,
        hasMore: selected.length > page.length,
        running: this.ctx.agents.get(sessionId)?.status === 'running',
      }
    })
    let page = await read()
    if (!page.events.length && waitMs > 0) {
      await new Promise((resolveWait) => {
        const done = () => {
          clearTimeout(timer)
          this.waiters.delete(done)
          resolveWait()
        }
        const timer = setTimeout(done, Math.min(waitMs, 20000))
        this.waiters.add(done)
      })
      page = await read()
    }
    await this.store.setCursor(consumerId, sessionId, page.cursor)
    return page
  }
}
