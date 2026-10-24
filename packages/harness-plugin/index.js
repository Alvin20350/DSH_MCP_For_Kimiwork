import { homedir } from 'node:os'
import { join } from 'node:path'
import { HarnessBridge } from './lib/bridge.js'
import { BridgeHttpServer } from './lib/server.js'
import { BridgeStore } from './lib/store.js'
import { compatibility } from './lib/version.js'

export const inject = ['sessionController', 'agents', 'sessions', 'sessionQuery', 'workspaceRegistry']

export async function apply(ctx, supplied = {}) {
  const config = {
    host: supplied.host ?? '127.0.0.1',
    port: supplied.port ?? 37841,
    tokenEnvVar: supplied.tokenEnvVar ?? 'KIMI_DSH_BRIDGE_TOKEN',
    allowedRoots: supplied.allowedRoots ?? [],
    allowUntestedHarness: supplied.allowUntestedHarness ?? false,
    stateFile: supplied.stateFile ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'kimi-subagent-bridge', 'state.json'),
  }
  if (config.host !== '127.0.0.1') throw new Error('Kimi bridge only supports 127.0.0.1')
  const compat = compatibility(undefined, config.allowUntestedHarness)
  if (!compat.allowed) {
    throw new Error(`Harness ${compat.harnessVersion} is not tested with this bridge; set allowUntestedHarness only after reviewing compatibility`)
  }
  const token = process.env[config.tokenEnvVar]
  if (!token) throw new Error(`Missing bridge credential in environment variable ${config.tokenEnvVar}`)

  const store = await new BridgeStore(config.stateFile).load()
  const bridge = new HarnessBridge(ctx, config, store)
  const server = new BridgeHttpServer(bridge, config, token)
  const address = await server.start()
  ctx.logger.info(`Kimi subagent bridge listening on http://${address.address}:${address.port}/mcp`)
  ctx.effect(() => async () => {
    bridge.close()
    await server.stop()
  }, 'kimi-subagent-bridge.stop')
}
