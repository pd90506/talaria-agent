/** Remote server stand-in for the bundled Host: the same window and packaged workspace, served by a dsh server. */
import type { DesktopHostReady, DesktopQuitInspection } from './host-process.ts'

/** Path of the server route that returns the Desktop startup injections. */
export const REMOTE_BOOT_PATH = 'desktop/boot'

/** Deadline for reading the startup injections from the server. */
export const REMOTE_BOOT_TIMEOUT_MS = 15_000

/**
 * Read the startup injections a remote dsh server renders for this Desktop.
 * The server authenticates the request itself, for example through Tailscale identity behind `tailscale serve`.
 * @param url - normalized server application root.
 * @param send - HTTP client; Electron's network stack in production.
 * @param signal - cancellation of the read.
 * @returns the injection rows.
 */
export async function readRemoteBoot(
  url: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<readonly unknown[]> {
  const target = new URL(REMOTE_BOOT_PATH, url).href
  const deadline = AbortSignal.timeout(REMOTE_BOOT_TIMEOUT_MS)
  const response = await send(target, { redirect: 'error', signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]) })
  if (!response.ok) throw new Error(`desktop remote: ${target} answered ${String(response.status)}; check that it runs dsh server and that this computer may sign in`)
  const body: unknown = await response.json()
  const injections = typeof body === 'object' && body !== null ? (body as { injections?: unknown }).injections : undefined
  if (!Array.isArray(injections)) throw new Error(`desktop remote: ${target} returned no startup injections`)
  const rows: readonly unknown[] = injections
  return rows
}

/** Remote server used through the Desktop backend lifecycle; no local process starts. */
export class DesktopRemoteHost {
  readonly #abort = new AbortController()

  /**
   * @param url - normalized server application root.
   * @param send - HTTP client; Electron's network stack in production.
   */
  constructor(private readonly url: string, private readonly send: (input: string, init?: RequestInit) => Promise<Response>) {}

  /** @returns the server root and its startup injections; the server owns authentication, so no cookie is attached. */
  async start(): Promise<DesktopHostReady> {
    const injections = await readRemoteBoot(this.url, this.send, this.#abort.signal)
    return { url: this.url, injections, authenticationCookie: '' }
  }

  /**
   * Cancel a pending startup read; the server keeps running.
   * @param _requireCleanStop - accepted for the bundled Host signature; nothing local can stop uncleanly.
   * @returns after cancellation.
   */
  stop(_requireCleanStop?: boolean): Promise<void> {
    this.#abort.abort()
    return Promise.resolve()
  }

  /**
   * @param _action - accepted for the bundled Host signature.
   * @returns false: local updates never stop work on the server.
   */
  updateTasks(_action: 'inspect' | 'lock' | 'unlock'): Promise<boolean> { return Promise.resolve(false) }

  /** @returns no affected work: tasks and schedules keep running on the server after Desktop quits. */
  inspectQuit(): Promise<DesktopQuitInspection> { return Promise.resolve({ activeTasks: false, scheduledTasks: false }) }

  /**
   * @param _address - Session-scoped file reference on the server.
   * @param _signal - accepted for the bundled Host signature.
   * @returns null: server files are not local, so file drag uses a downloaded copy.
   */
  resolveDragResource(_address: string, _signal?: AbortSignal): Promise<null> { return Promise.resolve(null) }
}
