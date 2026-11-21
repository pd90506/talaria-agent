/**
 * The server profile's Tailscale node reader. It queries the local Tailscale CLI once at load and provides
 * the `tailscaleNode` service, which the server bundle rows read for the advertised URL, the trusted
 * authority, and the owner login admitted by Tailscale authentication.
 * @module @deepseek-ai/dsh-server-app
 */

import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerDesktopBoot } from './desktop-boot.ts'
import { findServeUrl, parseStatus, type TailscaleNode } from './tailscale-status.ts'

export type { TailscaleNode } from './tailscale-status.ts'

/** Stable Cordis plugin name. */
export const name = 'server-tailscale-node'

/** Service provided by this plugin and injected by the server bundle rows. */
const TAILSCALE_NODE_SERVICE = 'tailscaleNode'

/** How this plugin reaches the local Tailscale node. */
export interface Config {
  /** Tailscale CLI executable name or path. */
  command: string
  /** Deadline for each CLI query, in milliseconds. */
  timeoutMs: number
  /** Loopback listener port that `tailscale serve` should proxy to. */
  listenPort: number
}

/** Validate the CLI location, query deadline, and listener port. */
export const Config: z<Config> = z.object({
  command: z.string().min(1).default('tailscale'),
  timeoutMs: z.natural().min(1).default(5000),
  listenPort: z.natural().min(1).max(65535).default(3080),
})

/**
 * Run one Tailscale CLI query.
 * @param config - CLI location and deadline.
 * @param args - CLI arguments.
 * @param signal - plugin disposal.
 * @returns the command's standard output.
 */
function query(config: Config, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(config.command, args, { timeout: config.timeoutMs, signal, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`server-app: \`${config.command} ${args.join(' ')}\` failed: ${stderr.trim() || error.message}; install Tailscale and run \`tailscale up\``, { cause: error }))
        return
      }
      resolve(stdout)
    })
  })
}

/**
 * Read the local Tailscale node and provide it as the `tailscaleNode` service, and serve the Desktop remote boot route.
 * A missing CLI, a stopped node, or a machine without MagicDNS fails the load.
 * @param ctx - plugin context.
 * @param config - validated CLI location, deadline, and listener port.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  registerDesktopBoot(ctx)
  const controller = new AbortController()
  ctx.effect(() => () => { controller.abort() }, 'server-app: Tailscale queries')
  const node = parseStatus(await query(config, ['status', '--json'], controller.signal))
  const serveUrl = findServeUrl(await query(config, ['serve', 'status', '--json'], controller.signal), node.dnsName, config.listenPort)
  if (serveUrl === undefined) {
    ctx.logger.warn('no `tailscale serve` handler proxies to port %d; run `tailscale serve --bg %d` to expose it to the Tailnet', config.listenPort, config.listenPort)
  }
  ctx.provide(TAILSCALE_NODE_SERVICE, { ...node, ...serveUrl !== undefined && { serveUrl } } satisfies TailscaleNode)
}
