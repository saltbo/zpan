import type { InstanceInfo } from '../shared/types/instance'

export type DeployPlatform = NonNullable<InstanceInfo['platform']>

declare global {
  var __ZPAN_PLATFORM__: DeployPlatform | undefined
}

// A deployment entry declares its platform at startup — the entry file IS the
// target, the most reliable signal. entry-node additionally sniffs Cloud Run /
// Docker, which share the Node entry. Cloudflare is detected from the D1 binding.
export function setDeployPlatform(platform: DeployPlatform): void {
  globalThis.__ZPAN_PLATFORM__ = platform
}

export function getDeployPlatform(): DeployPlatform | undefined {
  return globalThis.__ZPAN_PLATFORM__
}
