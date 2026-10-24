import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const EMPTY = Object.freeze({
  schemaVersion: 1,
  workspaces: {},
  requests: {},
  cursors: {},
})

function freshState() {
  return structuredClone(EMPTY)
}

function normalizeState(value) {
  if (!value || value.schemaVersion !== 1) {
    throw new Error('Unsupported Kimi bridge state schema')
  }
  return {
    schemaVersion: 1,
    workspaces: value.workspaces ?? {},
    requests: value.requests ?? {},
    cursors: value.cursors ?? {},
  }
}

/** Small durable index; DSH session logs remain the execution source of truth. */
export class BridgeStore {
  constructor(path) {
    this.path = path
    this.state = freshState()
    this.writeTail = Promise.resolve()
  }

  async load() {
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return this
  }

  async commit(mutator) {
    const operation = this.writeTail.then(async () => {
      const next = normalizeState(structuredClone(this.state))
      const result = await mutator(next)
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporary, this.path)
      this.state = next
      return result
    })
    this.writeTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  request(requestId) {
    return this.state.requests[requestId]
  }

  lastSession(cwd) {
    return this.state.workspaces[cwd]?.lastSessionId
  }

  cursor(consumerId, sessionId) {
    return this.state.cursors[`${consumerId}:${sessionId}`]
  }

  async bindRequest({ requestId, sessionId, cwd, promptHash }) {
    const now = new Date().toISOString()
    await this.commit((state) => {
      const existing = state.requests[requestId]
      if (existing && (existing.sessionId !== sessionId || existing.cwd !== cwd)) {
        throw new Error(`requestId "${requestId}" is already bound to another task`)
      }
      if (existing?.promptHash && promptHash && existing.promptHash !== promptHash) {
        throw new Error(`requestId "${requestId}" was already used for different prompt content`)
      }
      state.requests[requestId] = {
        sessionId,
        cwd,
        ...((existing?.promptHash ?? promptHash) ? { promptHash: existing?.promptHash ?? promptHash } : {}),
        createdAt: existing?.createdAt ?? now,
        lastActiveAt: now,
      }
      state.workspaces[cwd] = {
        lastSessionId: sessionId,
        updatedAt: now,
      }
    })
  }

  async touch(requestId, sessionId, cwd, promptHash) {
    if (!requestId) return
    await this.bindRequest({ requestId, sessionId, cwd, promptHash })
  }

  async setCursor(consumerId, sessionId, cursor) {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid event cursor')
    await this.commit((state) => {
      state.cursors[`${consumerId}:${sessionId}`] = cursor
    })
  }
}
