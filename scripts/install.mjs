import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessPackage = join(root, 'packages', 'harness-plugin')
const kimiPlugin = join(root, 'packages', 'personal', 'deepseek-subagent')
const kimiSkill = join(kimiPlugin, 'skills', 'deepseek-subagent', 'SKILL.md')
const testedVersions = ['0.2.1-rc.3']
const HELP = `Kimi DeepSeek Subagent installer

Usage: node scripts/install.mjs [options]

Options:
  --dsh-cli <path>          Harness Desktop CLI path (auto-detected when possible)
  --profile <name>          Harness profile (default: desktop)
  --kimi-daimon <path>      Kimi Work daemon CLI path
  --kimi-share <path>       Kimi Work shared-data directory
  --kimi-code-home <path>   Also merge MCP and skill into this Kimi Code home
  --skip-harness            Do not install the Harness bridge
  --skip-work               Do not register the Kimi Work plugin
  --allow-untested          Allow an unreviewed Harness version (risk accepted by caller)
  --help                    Show this help
`

function options(argv) {
  const result = { profile: 'desktop' }
  const flags = new Set(['skip-harness', 'skip-work', 'allow-untested', 'help'])
  const values = new Set(['dsh-cli', 'kimi-daimon', 'kimi-share', 'kimi-code-home', 'profile'])
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    const key = arg.slice(2)
    if (flags.has(key)) result[key] = true
    else if (values.has(key)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
      result[key] = value
    } else throw new Error(`Unknown option: --${key}`)
  }
  return result
}

function executable(path) {
  return path && existsSync(path) ? path : undefined
}

function detectDsh(explicit) {
  const candidates = [
    explicit,
    process.env.DSH_CLI,
    process.platform === 'win32' && join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepseekHarness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    process.platform === 'win32' && join(process.env.ProgramFiles ?? '', 'DeepseekHarness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'),
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh',
  ].filter(Boolean)
  for (const candidate of candidates) if (executable(candidate)) return candidate
  const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { encoding: 'utf8' })
  if (found.status === 0) return found.stdout.split(/\r?\n/)[0].trim()
  throw new Error('Cannot find the Harness Desktop CLI; pass --dsh-cli <path>')
}

function run(command, args, { capture = false } = {}) {
  let actualCommand = command
  let actualArgs = args
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
    actualCommand = 'powershell.exe'
    actualArgs = ['-NoProfile', '-NonInteractive', '-Command', `& ${quote(command)} ${args.map(quote).join(' ')}`]
  }
  return new Promise((resolveRun, reject) => {
    const child = spawn(actualCommand, actualArgs, {
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let stdout = ''
    let stderr = ''
    if (capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
    }
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolveRun({ stdout, stderr })
      else reject(new Error(`Command failed (${code}): ${command}\n${stderr}`))
    })
  })
}

async function ensureToken() {
  if (process.env.KIMI_DSH_BRIDGE_TOKEN) {
    console.log('Bridge token: using the current process environment')
    return
  }
  if (process.platform !== 'win32') {
    throw new Error('Set KIMI_DSH_BRIDGE_TOKEN in the GUI user environment first, then rerun this installer; no shell-only token was generated')
  }
  const existing = await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::GetEnvironmentVariable('KIMI_DSH_BRIDGE_TOKEN','User')",
  ], { capture: true })
  if (existing.stdout.trim()) {
    process.env.KIMI_DSH_BRIDGE_TOKEN = existing.stdout.trim()
    console.log('Bridge token: using the existing Windows user environment value')
    return
  }
  const token = randomBytes(32).toString('base64url')
  await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `[Environment]::SetEnvironmentVariable('KIMI_DSH_BRIDGE_TOKEN','${token}','User')`,
  ])
  process.env.KIMI_DSH_BRIDGE_TOKEN = token
  console.log('Bridge token: generated and stored in the Windows user environment')
}

async function installKimiCode(home) {
  const target = resolve(home)
  await mkdir(target, { recursive: true })
  const mcpPath = join(target, 'mcp.json')
  let config = { mcpServers: {} }
  try {
    config = JSON.parse(await readFile(mcpPath, 'utf8'))
    await copyFile(mcpPath, join(target, 'mcp.json.kimi-dsh-backup'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Refusing to overwrite invalid ${mcpPath}: ${error.message}`)
  }
  config.mcpServers ??= {}
  config.mcpServers['deepseek-subagent'] = {
    command: 'node',
    args: [join(kimiPlugin, 'scripts', 'stdio-proxy.bundle.mjs')],
    startupTimeoutMs: 10000,
    toolTimeoutMs: 30000,
  }
  await writeFile(mcpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  const skillDir = join(target, 'skills', 'deepseek-subagent')
  await mkdir(skillDir, { recursive: true })
  const skillPath = join(skillDir, 'SKILL.md')
  if (existsSync(skillPath)) await copyFile(skillPath, join(skillDir, 'SKILL.kimi-dsh-backup.md'))
  await copyFile(kimiSkill, skillPath)
  console.log(`Kimi Code: merged MCP and skill into ${target}`)
}

async function main() {
  const args = options(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return
  }
  const dsh = detectDsh(args['dsh-cli'])
  const version = (await run(dsh, ['--version'], { capture: true })).stdout.trim()
  console.log(`Harness Desktop CLI: ${version}`)
  if (!testedVersions.includes(version) && !args['allow-untested']) {
    throw new Error(`Harness ${version} is not tested; tested: ${testedVersions.join(', ')}. Review and pass --allow-untested to proceed`)
  }
  await ensureToken()

  if (!args['skip-harness']) {
    await run(dsh, ['plugin', '--profile', args.profile, 'add', harnessPackage, '--ignore-scripts'])
    console.log(`Harness bridge: installed into profile ${args.profile}`)
  }

  if (!args['skip-work']) {
    const daimon = args['kimi-daimon'] ?? process.env.DAIMON_RUNTIME_BINARY_PATH
    const share = args['kimi-share'] ?? process.env.KIMI_SHARE_DIR
    if (daimon && share) {
      await run(daimon, ['kimi-plugin', 'register-personal', kimiPlugin, '--share-dir', share, '--json'])
      console.log('Kimi Work: registered DeepSeek Subagent in the personal market; install it from the Personal tab')
    } else {
      console.log('Kimi Work: skipped automatic registration; pass --kimi-daimon and --kimi-share, or register through Kimi plugin tooling')
    }
  }

  if (args['kimi-code-home']) await installKimiCode(args['kimi-code-home'])
  console.log('Next: restart Harness Desktop, update the Kimi Work plugin, and open new Kimi Code sessions')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
