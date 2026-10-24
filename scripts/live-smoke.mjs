import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '../packages/harness-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../packages/harness-plugin/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'

const dsh = process.env.DSH_CLI ?? (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepseekHarness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
  : 'dsh')
const port = 39177
const token = randomBytes(24).toString('base64url')
const temp = await mkdtemp(join(tmpdir(), 'kimi-dsh-live-'))
const home = join(temp, 'home')
const workspace = join(temp, 'workspace')
const patch = join(temp, 'bridge.yml')
const profile = 'kimi-bridge-smoke'
let child

function windowsSecret(name) {
  if (process.env[name]) return process.env[name]
  if (process.platform !== 'win32') return undefined
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Environment]::GetEnvironmentVariable('${name}','User')`], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : undefined
}

const deepseekKey = windowsSecret('DEEPSEEK_API_KEY')
const childEnv = {
  ...process.env,
  DSH_HOME: home,
  KIMI_DSH_BRIDGE_TOKEN: token,
  ...(deepseekKey ? { DEEPSEEK_API_KEY: deepseekKey } : {}),
}

let childOutput = ''

function command(args, options = {}) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
  const invocation = process.platform === 'win32'
    ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `& ${quote(dsh)} ${args.map(quote).join(' ')}`] }
    : { file: dsh, args }
  return new Promise((resolveRun, reject) => {
    const processHandle = spawn(invocation.file, invocation.args, {
      env: childEnv,
      stdio: options.background || options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      ...options.background ? { windowsHide: true } : {},
    })
    if (options.background) {
      child = processHandle
      childOutput = ''
      const capture = (chunk) => { childOutput = `${childOutput}${chunk}`.slice(-50000) }
      processHandle.stdout.on('data', capture)
      processHandle.stderr.on('data', capture)
      return resolveRun(processHandle)
    }
    if (options.quiet) {
      processHandle.stdout.resume()
      processHandle.stderr.resume()
    }
    processHandle.on('error', reject)
    processHandle.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`dsh exited ${code}: ${args.join(' ')}`)))
  })
}

async function stop() {
  if (!child || child.killed) return
  const pid = child.pid
  child = undefined
  if (process.platform === 'win32') {
    await new Promise((resolveStop) => {
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
      killer.on('exit', resolveStop)
      killer.on('error', resolveStop)
    })
  } else {
    process.kill(pid, 'SIGTERM')
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 800))
}

async function waitHealth() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Temporary Harness exited ${child.exitCode}:\n${childOutput}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
  }
  throw new Error(`Temporary Harness did not become healthy within 90 seconds:\n${childOutput}`)
}

async function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: 'live-smoke', version: '1.0.0' })
  await client.connect(transport)
  return client
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`)
  return result.structuredContent
}

async function waitResult(client, sessionId, previousSeq = -1) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await call(client, 'ds_result', { sessionId })
    if (result.result?.seq > previousSeq && !result.running) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000))
  }
  throw new Error(`No final result for ${sessionId}`)
}

async function boot() {
  await command(['--profile', profile, '--patch', patch, '--no-open', '--port', String(port + 1)], { background: true })
  await waitHealth()
}

try {
  await mkdir(workspace, { recursive: true })
  await writeFile(patch, [
    '- id: kimi-subagent-bridge',
    '  config:',
    '    host: 127.0.0.1',
    `    port: ${port}`,
    '    tokenEnvVar: KIMI_DSH_BRIDGE_TOKEN',
    `    allowedRoots: [ ${JSON.stringify(temp)} ]`,
    '    allowUntestedHarness: false',
    '',
  ].join('\n'))
  await command(['--profile', profile, '--from-default-profile', 'web', '--dump-config'], { quiet: true })
  await command(['plugin', '--profile', profile, 'add', resolve('packages/harness-plugin'), '--ignore-scripts'])
  await boot()

  let client = await connect()
  const health = await call(client, 'ds_health')
  console.log(`协议: ${health.protocolVersion}; Harness: ${health.harnessVersion}`)
  const delegated = await call(client, 'ds_delegate', {
    cwd: workspace,
    prompt: '这是桥接测试。不要调用任何工具，只回复 BRIDGE_OK。',
    requestId: 'live-smoke-request-1',
  })
  console.log(`已创建会话: ${delegated.sessionId}`)
  const grouped = await call(client, 'ds_workspaces')
  if (!grouped.items.some((item) => item.sessionIds.includes(delegated.sessionId))) {
    throw new Error('Delegated session was not attached to its registered workspace')
  }
  console.log('工作区挂载检查通过')
  const first = await waitResult(client, delegated.sessionId)
  console.log(`首次结果: ${first.result.text.slice(0, 100)}`)
  await client.close()
  await stop()

  await boot()
  client = await connect()
  const continued = await call(client, 'ds_continue', { cwd: workspace })
  if (continued.sessionId !== delegated.sessionId) throw new Error('continue selected a different session')
  console.log(`重连恢复同一会话: ${continued.sessionId}`)
  await call(client, 'ds_send', {
    sessionId: delegated.sessionId,
    prompt: '继续桥接测试。不要调用任何工具，只回复 RECONNECT_OK。',
    requestId: 'live-smoke-request-2',
  })
  const second = await waitResult(client, delegated.sessionId, first.result.seq)
  console.log(`重连后控制结果: ${second.result.text.slice(0, 100)}`)
  const history = await call(client, 'ds_watch', { sessionId: delegated.sessionId, includeHistory: true, limit: 200 })
  console.log(`持久事件数量: ${history.events.length}`)
  await client.close()
  console.log('真实 Harness 冒烟测试通过')
} finally {
  if (child) await stop()
  await rm(temp, { recursive: true, force: true })
}
