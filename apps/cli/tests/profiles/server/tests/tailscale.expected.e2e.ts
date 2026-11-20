/** Built server-profile acceptance: Tailscale node detection, the advertised Tailnet root, and identity-header sign-in. */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { PROCESS_SHUTDOWN_TIMEOUT_MS } from '../../../../src/process-shutdown.ts'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const dshBin = join(repoRoot, 'apps/cli/lib/bin.js')
const fakeTailscale = join(repoRoot, 'packages/bundle/server-app/tests/fixtures/fake-tailscale.mjs')

const DNS_NAME = 'box.tail1234.ts.net'
const STATUS = JSON.stringify({
  BackendState: 'Running',
  Self: { DNSName: `${DNS_NAME}.`, UserID: 42 },
  User: { 42: { LoginName: 'alice@github' } },
})

/** One booted server process: its bound port, printed startup URL, and bounded stop. */
interface RunningServer {
  port: number
  startup: URL
  /** Stop the child within the shutdown deadline; resolves its exit code and standard error. */
  stop(): Promise<{ exitCode: number | undefined; stderr: string }>
}

/**
 * Boot the built CLI's server profile against the fake Tailscale CLI and wait for its URL line and bound port.
 * @param root - private directory for the Harness home, patches, and interrupt marker.
 * @returns the running server.
 */
async function bootServer(root: string): Promise<RunningServer> {
  const marker = join(root, 'listen-port.mjs')
  const interrupt = join(root, 'interrupt')
  writeFileSync(marker, [
    "import { existsSync } from 'node:fs'",
    "export const name = 'server-listen-port'",
    "export const inject = ['webServer']",
    'export function apply(ctx) {',
    "  console.log('server-listen-port: ' + ctx.webServer.port)",
    '  const heartbeat = setInterval(() => {',
    '    if (!existsSync(process.env.SERVER_INTERRUPT_FILE)) return',
    '    clearInterval(heartbeat)',
    "    process.emit('SIGTERM')",
    '  }, 20)',
    '  ctx.effect(() => () => { clearInterval(heartbeat) })',
    '}',
    '',
  ].join('\n'))
  const patch = join(root, 'extra.yml')
  writeFileSync(patch, [
    '- id: server-tailscale-node',
    '  config:',
    `    command: ${JSON.stringify(fakeTailscale)}`,
    '- insert:',
    `    - name: ${JSON.stringify(pathToFileURL(marker).href)}`,
    '',
  ].join('\n'))
  const child = execa(process.execPath, [dshBin, 'server', '--patch', patch, '--port', '0'], {
    cwd: root,
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: 'keyless-server-tailscale-no-call',
      DSH_AGENTS_HOME: join(root, '.agents'),
      DSH_HOME: join(root, 'home'),
      DSH_TELEMETRY_DISABLED: '1',
      NODE_NO_WARNINGS: '1',
      FAKE_TAILSCALE_STATUS: STATUS,
      FAKE_TAILSCALE_SERVE: '{}',
      SERVER_INTERRUPT_FILE: interrupt,
    },
    input: '',
    reject: false,
    timeout: 90_000,
    killSignal: 'SIGKILL',
  })
  const lines = createInterface({ input: child.stdout })
  const ready = Promise.withResolvers<RunningServer>()
  let port: number | undefined
  let startup: URL | undefined
  let stopping: ReturnType<RunningServer['stop']> | undefined
  const stop = async () => {
    writeFileSync(interrupt, '')
    const deadline = setTimeout(() => { child.kill('SIGKILL') }, PROCESS_SHUTDOWN_TIMEOUT_MS * 2)
    try {
      const result = await child
      return { exitCode: result.exitCode, stderr: result.stderr }
    } finally {
      clearTimeout(deadline)
    }
  }
  lines.on('line', (line) => {
    if (line.startsWith('server-listen-port: ')) port = Number(line.slice('server-listen-port: '.length))
    if (line.startsWith('dsh web: ')) startup = new URL(line.slice('dsh web: '.length))
    if (port !== undefined && startup !== undefined) ready.resolve({ port, startup, stop: () => stopping ??= stop() })
  })
  void child.then((result) => {
    ready.reject(new Error(`server exited before readiness (code ${String(result.exitCode)})\n${result.stderr}`))
  })
  try {
    return await ready.promise
  } catch (error) {
    child.kill('SIGKILL')
    await child
    throw error
  } finally {
    lines.close()
  }
}

/**
 * Send one request to the loopback listener as `tailscale serve` would forward it.
 * @param port - listener port.
 * @param path - request path.
 * @param method - HTTP method; POST carries a Session-create RPC.
 * @param login - `Tailscale-User-Login` value, or undefined to omit it.
 * @returns status code and body.
 */
async function request(port: number, path: string, method: 'GET' | 'POST', login?: string): Promise<{ status: number; body: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>()
  const req = httpRequest({
    host: '127.0.0.1', port, path, method,
    headers: {
      'host': DNS_NAME,
      'origin': `https://${DNS_NAME}`,
      'content-type': 'application/json',
      ...login === undefined ? {} : { 'tailscale-user-login': login },
    },
  }, resolve)
  req.once('error', reject)
  req.setTimeout(10_000, () => { req.destroy(new Error('HTTP request timed out')) })
  req.end(method === 'POST'
    ? JSON.stringify({ type: 'client-request', rpcId: 'server-tailscale', method: 'session/create', payload: { args: { request: {} } } })
    : undefined)
  const response = await promise
  let body = ''
  for await (const chunk of response) body += String(chunk)
  return { status: response.statusCode!, body }
}

describe.skipIf(!existsSync(dshBin) || process.platform === 'win32')('server profile over Tailscale Serve', () => {
  it('advertises the Tailnet root and admits only the machine owner without a launch token', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-server-tailscale-'))
    let server: RunningServer | undefined
    try {
      server = await bootServer(root)
      expect(server.startup.origin).toBe(`https://${DNS_NAME}`)
      expect(server.startup.searchParams.has('token')).toBe(true)
      const index = await request(server.port, '/', 'GET', 'alice@github')
      expect(index.status).toBe(200)
      expect(index.body).toContain('<html')
      const created = await request(server.port, '/api/session/create', 'POST', 'alice@github')
      expect(created.status).toBe(200)
      expect(JSON.parse(created.body)).toMatchObject({ result: { ok: true } })
      expect((await request(server.port, '/', 'GET', 'mallory@github')).status).toBe(401)
      expect((await request(server.port, '/api/session/create', 'POST')).status).toBe(401)
      const stopped = await server.stop()
      expect(stopped.exitCode, stopped.stderr).toBe(0)
    } finally {
      try {
        await server?.stop()
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})
