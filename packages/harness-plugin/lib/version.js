import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const BRIDGE_VERSION = '0.1.1'
export const PROTOCOL_VERSION = 'kimi-dsh-bridge/v1'
export const TESTED_HARNESS_VERSIONS = ['0.2.1-rc.3']

export function harnessVersion() {
  if (process.env.DSH_CLIENT_VERSION) return process.env.DSH_CLIENT_VERSION
  try {
    return require('@deepseek-ai/dsh-agent/package.json').version
  } catch {
    return 'unknown'
  }
}

export function compatibility(version = harnessVersion(), allowUntested = false) {
  const tested = TESTED_HARNESS_VERSIONS.includes(version)
  const unknown = version === 'unknown'
  return {
    harnessVersion: version,
    testedHarnessVersions: TESTED_HARNESS_VERSIONS,
    tested,
    versionUnknown: unknown,
    allowed: tested || unknown || allowUntested,
  }
}
