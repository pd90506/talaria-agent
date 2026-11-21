/** Desktop connection target: the bundled local Host or a remote dsh server, stored beside shell settings. */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { DesktopMessages } from './locale.ts'

/** Where Desktop runs the agent: its own bundled Host, or a remote dsh server's Web application. */
export type DesktopConnection =
  | { readonly mode: 'local' }
  | { readonly mode: 'remote'; readonly url: string }

/** Scheme of the navigation the connection page uses to report a choice without a preload bridge. */
export const CONNECTION_SCHEME = 'dsh-connect:'

/**
 * Resolve the connection document location.
 * @param userData - Electron userData, independent of DSH_HOME.
 * @returns the connection file path.
 */
export function desktopConnectionPath(userData: string): string {
  return join(userData, 'desktop', 'connection.json')
}

/**
 * Normalize a server address to the application root browsers open.
 * @param value - user or file input.
 * @returns the canonical `http:` or `https:` root without query or fragment, or undefined when invalid.
 */
export function normalizeServerUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch (_error) {
    // Unparseable input is reported to the caller as an invalid address.
    return undefined
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return undefined
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/**
 * Parse a stored connection document.
 * @param text - file contents.
 * @returns the connection, or undefined when the document is not a valid connection.
 */
export function parseDesktopConnection(text: string): DesktopConnection | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (_error) {
    // A corrupt document falls back to the local Host; the caller logs the path.
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { mode?: unknown; url?: unknown }
  if (record.mode === 'local') return { mode: 'local' }
  if (record.mode !== 'remote' || typeof record.url !== 'string') return undefined
  const url = normalizeServerUrl(record.url)
  return url === undefined ? undefined : { mode: 'remote', url }
}

/**
 * Read the connection target. `DSH_DESKTOP_SERVER_URL` overrides the stored document for this launch.
 * @param userData - Electron userData.
 * @param env - process environment.
 * @returns the connection; a missing or invalid document selects the local Host.
 */
export async function readDesktopConnection(userData: string, env: NodeJS.ProcessEnv): Promise<DesktopConnection> {
  const override = env.DSH_DESKTOP_SERVER_URL
  if (override !== undefined && override !== '') {
    const url = normalizeServerUrl(override)
    if (url === undefined) throw new Error(`desktop connection: DSH_DESKTOP_SERVER_URL is not an http or https address: ${override}`)
    return { mode: 'remote', url }
  }
  const path = desktopConnectionPath(userData)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'local' }
    console.warn(`desktop connection: ${path}: using the local Host because the file could not be read`, error)
    return { mode: 'local' }
  }
  const connection = parseDesktopConnection(text)
  if (connection === undefined) console.warn(`desktop connection: ${path}: using the local Host because the file is invalid`)
  return connection ?? { mode: 'local' }
}

/**
 * Persist the connection target for later launches.
 * @param userData - Electron userData.
 * @param connection - the target to store.
 */
export async function writeDesktopConnection(userData: string, connection: DesktopConnection): Promise<void> {
  const path = desktopConnectionPath(userData)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 })
}

/** What the user chose on a connection or failure page. */
export type ConnectionIntent =
  | { readonly kind: 'connect'; readonly url: string | undefined }
  | { readonly kind: 'local' }
  | { readonly kind: 'edit' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'cancel' }

/**
 * Decode a navigation to {@link CONNECTION_SCHEME}.
 * @param href - navigation target.
 * @returns the intent, or undefined for any other navigation.
 */
export function parseConnectionIntent(href: string): ConnectionIntent | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch (_error) {
    // Not a URL the connection page produced.
    return undefined
  }
  if (url.protocol !== CONNECTION_SCHEME) return undefined
  switch (url.hostname) {
    case 'connect': return { kind: 'connect', url: normalizeServerUrl(url.searchParams.get('url') ?? '') }
    case 'local': return { kind: 'local' }
    case 'edit': return { kind: 'edit' }
    case 'retry': return { kind: 'retry' }
    case 'cancel': return { kind: 'cancel' }
    default: return undefined
  }
}

/** Escape text for an HTML text node or a double-quoted attribute. */
function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

const PAGE_STYLE = `
:root{color-scheme:light dark;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{margin:0;padding:28px;background:Canvas;color:CanvasText}
h1{font-size:18px;margin:0 0 8px}p{margin:0 0 16px;opacity:.75;line-height:1.5}
label{display:block;font-weight:600;margin-bottom:6px}
input{box-sizing:border-box;width:100%;padding:8px 10px;font:inherit;border:1px solid #8886;border-radius:6px;background:Field;color:FieldText}
.error{color:#d33;margin:8px 0 0;opacity:1}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:20px;flex-wrap:wrap}
button,a.button{font:inherit;padding:7px 14px;border-radius:6px;border:1px solid #8886;background:ButtonFace;color:ButtonText;text-decoration:none;cursor:default}
button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.spacer{flex:1}`

/**
 * Build the connection page. Choices navigate to {@link CONNECTION_SCHEME} URLs that the main process intercepts.
 * @param messages - localized shell copy.
 * @param current - the active connection, prefilled when remote.
 * @param error - an invalid-address message to show, if any.
 * @returns a `data:` URL holding the page.
 */
export function connectionPageUrl(messages: DesktopMessages, current: DesktopConnection, error?: string): string {
  const value = current.mode === 'remote' ? current.url : ''
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(messages.connectionTitle)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action dsh-connect:">
<style>${PAGE_STYLE}</style></head><body>
<h1>${escapeHtml(messages.connectionTitle)}</h1>
<p>${escapeHtml(messages.connectionDescription)}</p>
<form action="dsh-connect://connect" method="get">
<label for="url">${escapeHtml(messages.connectionUrlLabel)}</label>
<input id="url" name="url" type="url" required autofocus placeholder="https://server.tailnet.ts.net/" value="${escapeHtml(value)}">
${error === undefined ? '' : `<p class="error">${escapeHtml(error)}</p>`}
<div class="row">
<a class="button" href="dsh-connect://local">${escapeHtml(messages.connectionUseLocal)}</a>
<span class="spacer"></span>
<a class="button" href="dsh-connect://cancel">${escapeHtml(messages.connectionCancel)}</a>
<button class="primary" type="submit">${escapeHtml(messages.connectionConnect)}</button>
</div></form></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * Build the page shown when the remote server cannot be loaded.
 * @param messages - localized shell copy.
 * @param url - the server address.
 * @param detail - the load failure description.
 * @returns a `data:` URL holding the page.
 */
export function remoteFailurePageUrl(messages: DesktopMessages, url: string, detail: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(messages.connectionTitle)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${PAGE_STYLE}</style></head><body>
<h1>${escapeHtml(messages.remoteUnreachableTitle)}</h1>
<p>${escapeHtml(messages.remoteUnreachable.replace('{url}', url))}</p>
<p><code>${escapeHtml(detail)}</code></p>
<div class="row">
<a class="button" href="dsh-connect://local">${escapeHtml(messages.connectionUseLocal)}</a>
<span class="spacer"></span>
<a class="button" href="dsh-connect://edit">${escapeHtml(messages.connectServerMenu)}</a>
<a class="button primary" href="dsh-connect://retry">${escapeHtml(messages.remoteRetry)}</a>
</div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * Validate a connection choice received over IPC.
 * @param value - untrusted renderer input.
 * @returns the normalized target, or undefined when it is not a local choice or a valid remote address.
 */
export function parseConnectionTarget(value: unknown): DesktopConnection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { mode?: unknown; url?: unknown }
  if (record.mode === 'local') return { mode: 'local' }
  if (record.mode !== 'remote' || typeof record.url !== 'string') return undefined
  const url = normalizeServerUrl(record.url)
  return url === undefined ? undefined : { mode: 'remote', url }
}
