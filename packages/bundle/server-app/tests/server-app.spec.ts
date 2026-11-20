/** The server bundle's Tailscale node reader and declared profile patch. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { parseEntryYaml } from '@deepseek-ai/cordis-plugin-include'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as ServerApp from '../src/index.ts'
import type { TailscaleNode } from '../src/index.ts'
import { findServeUrl, parseStatus } from '../src/tailscale-status.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const fakeTailscale = resolve(root, 'tests/fixtures/fake-tailscale.mjs')

const config = (overrides: Partial<ServerApp.Config> = {}): ServerApp.Config => ({
  command: fakeTailscale, timeoutMs: 5000, listenPort: 3080, ...overrides,
})

const status = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  BackendState: 'Running',
  Self: { DNSName: 'box.tail1234.ts.net.', UserID: 42 },
  User: { 42: { LoginName: 'alice@github' } },
  ...overrides,
})

const serve = (proxy: string, authority = 'box.tail1234.ts.net:443'): string => JSON.stringify({
  Web: { [authority]: { Handlers: { '/': { Proxy: proxy } } } },
})

describe('parseStatus', () => {
  it('reads the MagicDNS name and the owner login', () => {
    expect(parseStatus(status())).toEqual({ dnsName: 'box.tail1234.ts.net', ownerLogins: ['alice@github'] })
  })

  it('reports no owner for a tagged machine', () => {
    expect(parseStatus(status({ Self: { DNSName: 'box.tail1234.ts.net.', UserID: 42, Tags: ['tag:server'] } })).ownerLogins).toEqual([])
  })

  it('rejects a stopped node, a missing MagicDNS name, and non-JSON output', () => {
    expect(() => parseStatus(status({ BackendState: 'Stopped' }))).toThrow(/tailscale up/)
    expect(() => parseStatus(status({ Self: { DNSName: '', UserID: 42 } }))).toThrow(/MagicDNS/)
    expect(() => parseStatus('nope')).toThrow(/not JSON/)
    expect(() => parseStatus('null')).toThrow(/non-object/)
  })
})

describe('findServeUrl', () => {
  it('finds the HTTPS root proxying to the listener port', () => {
    expect(findServeUrl(serve('http://127.0.0.1:3080'), 'box.tail1234.ts.net', 3080)).toBe('https://box.tail1234.ts.net/')
    expect(findServeUrl(serve('http://localhost:3080', 'box.tail1234.ts.net:8443'), 'box.tail1234.ts.net', 3080)).toBe('https://box.tail1234.ts.net:8443/')
  })

  it('ignores handlers for other ports, hosts, and non-loopback targets', () => {
    expect(findServeUrl(serve('http://127.0.0.1:9000'), 'box.tail1234.ts.net', 3080)).toBeUndefined()
    expect(findServeUrl(serve('http://10.0.0.2:3080'), 'box.tail1234.ts.net', 3080)).toBeUndefined()
    expect(findServeUrl(serve('http://127.0.0.1:3080', 'other.tail1234.ts.net:443'), 'box.tail1234.ts.net', 3080)).toBeUndefined()
    expect(findServeUrl('{}', 'box.tail1234.ts.net', 3080)).toBeUndefined()
    expect(findServeUrl(serve('https+insecure://127.0.0.1:3080'), 'box.tail1234.ts.net', 3080)).toBeUndefined()
    expect(findServeUrl(JSON.stringify({ Web: { 'box.tail1234.ts.net:443': {} } }), 'box.tail1234.ts.net', 3080)).toBeUndefined()
  })

  it('reads a port-less proxy target as port 80 and rejects non-JSON output', () => {
    expect(findServeUrl(serve('http://127.0.0.1'), 'box.tail1234.ts.net', 80)).toBe('https://box.tail1234.ts.net/')
    expect(() => findServeUrl('nope', 'box.tail1234.ts.net', 3080)).toThrow(/not JSON/)
  })
})

describe.skipIf(process.platform === 'win32')('server-tailscale-node plugin', () => {
  it('provides the node read from the Tailscale CLI', async () => {
    vi.stubEnv('FAKE_TAILSCALE_STATUS', status())
    vi.stubEnv('FAKE_TAILSCALE_SERVE', serve('http://127.0.0.1:3080', 'box.tail1234.ts.net:8443'))
    onTestFinished(() => { vi.unstubAllEnvs() })
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(ServerApp, config()).await()
    expect(ctx.get('tailscaleNode') as TailscaleNode).toEqual({
      dnsName: 'box.tail1234.ts.net',
      ownerLogins: ['alice@github'],
      serveUrl: 'https://box.tail1234.ts.net:8443/',
    })
  })

  it('warns and omits the serve root when no handler proxies to the listener', async () => {
    vi.stubEnv('FAKE_TAILSCALE_STATUS', status())
    vi.stubEnv('FAKE_TAILSCALE_SERVE', '{}')
    onTestFinished(() => { vi.unstubAllEnvs() })
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    await ctx.plugin(ServerApp, config({ listenPort: 4000 })).await()
    expect(ctx.get('tailscaleNode')).toEqual({ dnsName: 'box.tail1234.ts.net', ownerLogins: ['alice@github'] })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tailscale serve --bg'), 4000, 4000)
  })

  it('fails the load when the CLI cannot run', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const fiber = ctx.plugin(ServerApp, config({ command: resolve(root, 'tests/fixtures/missing-tailscale') }))
    await expect(fiber.await()).rejects.toThrow(/install Tailscale/)
    expect(ctx.get('tailscaleNode')).toBeUndefined()
  })
})

describe('dsh-server-app bundle', () => {
  it('declares Tailscale authentication, trust, and advertisement over the Web rows', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-host-authentication-tailscale')
    const patches = parseEntryYaml(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8')) as Array<{
      id?: string
      disabled?: boolean
      inject?: string[]
      insert?: Array<{ id?: string; inject?: string[]; name?: string }>
    }>
    expect(patches.find(patch => patch.id === 'hmr')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'connection')?.inject).toEqual(['webStartup', 'tailscaleNode'])
    expect(patches.find(patch => patch.id === 'web-runtime')?.inject).toEqual(['webStartup', 'tailscaleNode'])
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows.find(row => row.id === 'server-tailscale-node')?.name).toBe('@deepseek-ai/dsh-server-app')
    expect(rows.find(row => row.id === 'authentication-tailscale')).toMatchObject({
      name: '@deepseek-ai/dsh-host-authentication-tailscale',
      inject: ['tailscaleNode'],
    })
  })
})
