const QUICK_TUNNEL_502 = /trycloudflare\.com\s*\|\s*502:\s*Bad gateway/i
const CLIENT_TRANSPORT_FAILURE = /(?:\b502\b|ERR_(?:FAILED|TUNNEL_CONNECTION_FAILED)|ECONNRESET|socket hang up)/i
const TUNNEL_CONTEXT_CANCELED = /(?:Incoming request ended abruptly|Request failed)[^\n]*context canceled/i
const QUICK_TUNNEL_REQUEST = /trycloudflare\.com/i

export class CloudE2eCommandError extends Error {
  constructor(command, commandArgs, code, output) {
    super(`${command} ${commandArgs.join(' ')} exited with ${code}`)
    this.output = output
  }
}

export function cloudE2eEndpoints(localBaseUrl, tunnelUrl) {
  return {
    browserBaseUrl: localBaseUrl,
    publicBaseUrl: tunnelUrl ?? localBaseUrl,
  }
}

export function cloudflaredQuickTunnelArgs(target) {
  return ['tunnel', '--url', target, '--protocol', 'http2', '--no-autoupdate']
}

export function isRetryableQuickTunnelFailure({ commandOutput, tunnelOutput }) {
  if (QUICK_TUNNEL_502.test(commandOutput)) return true
  return (
    CLIENT_TRANSPORT_FAILURE.test(commandOutput) &&
    TUNNEL_CONTEXT_CANCELED.test(tunnelOutput) &&
    QUICK_TUNNEL_REQUEST.test(tunnelOutput)
  )
}

export function cloudE2eAttemptCount(value) {
  if (value === undefined) return 2
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('E2E_TUNNEL_RUN_ATTEMPTS must be a positive integer')
  }
  return count
}
