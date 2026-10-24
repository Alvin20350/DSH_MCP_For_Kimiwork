import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { BridgeStore } from '../lib/store.js'

test('store restores workspace bindings and cursors after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kimi-dsh-store-'))
  const path = join(directory, 'state.json')
  try {
    const first = await new BridgeStore(path).load()
    await first.bindRequest({ requestId: 'r1', sessionId: 's1', cwd: '/work/a', promptHash: 'abc' })
    await first.setCursor('kimi', 's1', 42)
    const second = await new BridgeStore(path).load()
    assert.equal(second.lastSession('/work/a'), 's1')
    assert.equal(second.request('r1').promptHash, 'abc')
    assert.equal(second.cursor('kimi', 's1'), 42)
    await assert.rejects(
      second.bindRequest({ requestId: 'r1', sessionId: 's1', cwd: '/work/a', promptHash: 'different' }),
      /different prompt content/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
