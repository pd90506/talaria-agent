/**
 * Desktop remote boot route: the startup injections a Desktop window needs to run its packaged workspace
 * against this server.
 * @module @deepseek-ai/dsh-server-app/desktop-boot
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Path Desktop reads before it opens its packaged workspace against a remote server. */
export const DESKTOP_BOOT_PATH = '/desktop/boot'

/**
 * Serve `GET /desktop/boot` to the owner: `{ injections }`, the index injection rows of the requesting Peer.
 * Other principals receive 403.
 * @param ctx - context that owns the route registration.
 */
export function registerDesktopBoot(ctx: Context): void {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: DESKTOP_BOOT_PATH,
      auth: 'required',
      resource: async (request, peer) => {
        if (peer?.principal.kind !== 'owner') return Response.json({ code: 'forbidden' }, { status: 403 })
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
        return Response.json({ injections: webCtx.webServer.collectIndexInjections(peer) }, { headers: { 'cache-control': 'no-store' } })
      },
    }), `server-app: GET ${DESKTOP_BOOT_PATH}`)
  })
}
