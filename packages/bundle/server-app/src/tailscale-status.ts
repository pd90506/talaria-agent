/**
 * Pure readers of `tailscale status --json` and `tailscale serve status --json` output.
 * @module @deepseek-ai/dsh-server-app/tailscale-status
 */

/** The facts the server profile reads from the local Tailscale node. */
export interface TailscaleNode {
  /** MagicDNS name of this machine without the trailing dot, such as `host.tailnet.ts.net`. */
  dnsName: string
  /** Login names of the Tailnet user who owns this machine; empty for a tagged machine. */
  ownerLogins: string[]
  /** HTTPS root that `tailscale serve` exposes for the listener, when one proxies to it. */
  serveUrl?: string
}

/** Report malformed Tailscale output with the command that produced it. */
function invalid(command: string, detail: string): Error {
  return new Error(`server-app: \`${command}\` returned ${detail}`)
}

/**
 * Read the node name and owner from `tailscale status --json`.
 * @param text - complete standard output of the command.
 * @returns the MagicDNS name and owner logins.
 */
export function parseStatus(text: string): Omit<TailscaleNode, 'serveUrl'> {
  const command = 'tailscale status --json'
  let value: unknown
  try { value = JSON.parse(text) } catch { throw invalid(command, 'output that is not JSON') }
  if (typeof value !== 'object' || value === null) throw invalid(command, 'a non-object value')
  const status = value as { BackendState?: unknown; Self?: unknown; User?: unknown }
  if (status.BackendState !== 'Running') {
    throw new Error(`server-app: Tailscale is ${JSON.stringify(status.BackendState)}, not Running; run \`tailscale up\` and restart`)
  }
  const self = status.Self as { DNSName?: unknown; UserID?: unknown; Tags?: unknown } | undefined
  if (typeof self?.DNSName !== 'string' || !self.DNSName.endsWith('.ts.net.')) {
    throw invalid(command, 'no MagicDNS name for this machine; enable MagicDNS in the Tailnet')
  }
  const dnsName = self.DNSName.slice(0, -1)
  const tagged = Array.isArray(self.Tags) && self.Tags.length > 0
  const users = status.User as Record<string, { LoginName?: unknown } | undefined> | undefined
  const login = tagged ? undefined : users?.[String(self.UserID)]?.LoginName
  return { dnsName, ownerLogins: typeof login === 'string' && login !== '' ? [login] : [] }
}

/**
 * Find the HTTPS root that `tailscale serve` proxies to a loopback listener port.
 * @param text - complete standard output of `tailscale serve status --json`.
 * @param dnsName - this machine's MagicDNS name.
 * @param port - the listener port the proxy must target.
 * @returns the `https://` root, or undefined when no root handler proxies to the port.
 */
export function findServeUrl(text: string, dnsName: string, port: number): string | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw invalid('tailscale serve status --json', 'output that is not JSON') }
  const web = (value as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }> } | null)?.Web ?? {}
  for (const [authority, config] of Object.entries(web)) {
    const proxy = config.Handlers?.['/']?.Proxy
    if (typeof proxy !== 'string' || !proxy.startsWith('http://')) continue
    const target = new URL(proxy)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || Number(target.port || 80) !== port) continue
    const [host, servePort] = authority.split(':')
    if (host !== dnsName) continue
    return servePort === undefined || servePort === '443' ? `https://${host}/` : `https://${host}:${servePort}/`
  }
  return undefined
}
