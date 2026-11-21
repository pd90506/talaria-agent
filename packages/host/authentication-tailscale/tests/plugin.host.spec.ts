/** Tailscale authentication is owned by its mounted plugin fiber. */
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { expect, it, onTestFinished } from 'vitest'
import * as TailscaleAuthentication from '../src/index.ts'

it('admits only allowed Tailscale logins as one owner Peer and unregisters on disposal', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(Connection).await()
  const plugin = ctx.plugin(TailscaleAuthentication, { allowedLogins: ['alice@github'] })
  await plugin.await()
  const request = { headers: { 'tailscale-user-login': 'alice@github' } }
  const first = ctx.connection.authentication.authenticate(request)
  if ('rejection' in first) throw new Error('Tailscale provider did not activate')
  expect(first.peer).not.toBe(ctx.connection.browserPeer)
  expect(ctx.connection.authentication.authenticate({ headers: new Headers(request.headers) })).toEqual({ peer: first.peer })
  expect(ctx.connection.authentication.authenticate({ headers: {} })).toEqual({ rejection: 401 })
  expect(ctx.connection.authentication.authenticate({ headers: { 'tailscale-user-login': 'mallory@github' } })).toEqual({ rejection: 401 })
  expect(ctx.connection.authentication.authenticate({ headers: { 'tailscale-user-login': '' } })).toEqual({ rejection: 401 })
  expect(ctx.connection.authentication.authenticate({ headers: { 'tailscale-user-login': 'alice@github, alice@github' } })).toEqual({ rejection: 401 })
  await plugin.dispose()
  expect(first.peer.signal.aborted).toBe(true)
  expect(ctx.connection.authentication.authenticate(request)).toEqual({ rejection: 401 })
})

it('rejects a configuration that admits nobody', () => {
  expect(() => TailscaleAuthentication.Config({ allowedLogins: [] })).toThrow()
  expect(() => TailscaleAuthentication.Config({ allowedLogins: ['has space'] })).toThrow()
})
