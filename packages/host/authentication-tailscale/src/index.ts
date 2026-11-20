/** Tailscale Serve identity-header verifier, registered as an ordinary Connection provider. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConnectionTrustRequest } from '@deepseek-ai/dsh-client-connection'

/** Stable plugin name. */
export const name = 'host-authentication-tailscale'
/** Connection creates Peers; ConnectionAuthentication owns credential verifiers. */
export const inject = ['connection', 'connection.authentication']

/** Header that Tailscale Serve sets to the login name of the Tailnet user who sent the request. */
const TAILSCALE_USER_LOGIN_HEADER = 'tailscale-user-login'

/** Tailnet users admitted as the owner. */
export interface Config {
  /** Tailscale login names, such as `alice@github`, admitted with owner access; at least one. */
  allowedLogins: string[]
}

/** Require at least one nonblank login, so a mounted provider never admits nobody silently. */
export const Config: z<Config> = z.object({
  allowedLogins: z.array(z.string().pattern(/^\S+$/u)).min(1),
})

/**
 * Read the single Tailscale login header of a request.
 * @param headers - Fetch or node:http request headers.
 * @returns the header value, or undefined when it is absent, repeated, or empty.
 */
function loginOf(headers: ConnectionTrustRequest['headers']): string | undefined {
  const value = headers instanceof Headers ? headers.get(TAILSCALE_USER_LOGIN_HEADER) : headers[TAILSCALE_USER_LOGIN_HEADER]
  if (typeof value !== 'string' || value === '' || value.includes(',')) return undefined
  return value
}

/**
 * Own one owner Peer and the verifier admitting requests whose Tailscale login is allowed.
 * The header is trustworthy only when the listener is reachable solely through `tailscale serve`
 * on this machine; any local process that reaches the listener directly can set it.
 * @param ctx - plugin scope owning the Peer and registration.
 * @param config - validated allowed login names.
 */
export function apply(ctx: Context, config: Config): void {
  const allowed = new Set(config.allowedLogins)
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } })
  ctx.connection.authentication.register({
    authenticate(request) {
      const login = loginOf(request.headers)
      return login !== undefined && allowed.has(login) ? peer : undefined
    },
  })
}
