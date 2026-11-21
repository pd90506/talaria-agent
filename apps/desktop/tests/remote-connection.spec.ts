/** Desktop connection target storage, address normalization, and connection page intents. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { en } from '../src/locale.ts'
import {
  connectionPageUrl,
  desktopConnectionPath,
  normalizeServerUrl,
  parseConnectionIntent,
  parseConnectionTarget,
  parseDesktopConnection,
  readDesktopConnection,
  writeDesktopConnection,
} from '../src/remote-connection.ts'

const userData = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-connection-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

const pageText = (url: string): string => decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length))

describe('normalizeServerUrl', () => {
  it('returns the application root without query, fragment, or credentials', () => {
    expect(normalizeServerUrl(' https://box.tail1234.ts.net ')).toBe('https://box.tail1234.ts.net/')
    expect(normalizeServerUrl('https://box.tail1234.ts.net:8443/ui?token=x#y')).toBe('https://box.tail1234.ts.net:8443/ui/')
    expect(normalizeServerUrl('http://127.0.0.1:3080/')).toBe('http://127.0.0.1:3080/')
  })

  it('rejects non-HTTP schemes, credentials, and unparseable input', () => {
    expect(normalizeServerUrl('file:///etc/passwd')).toBeUndefined()
    expect(normalizeServerUrl('https://user:pass@box.ts.net/')).toBeUndefined()
    expect(normalizeServerUrl('box.ts.net')).toBeUndefined()
  })
})

describe('stored connection', () => {
  it('parses local and remote documents and rejects invalid ones', () => {
    expect(parseDesktopConnection('{"mode":"local"}')).toEqual({ mode: 'local' })
    expect(parseDesktopConnection('{"mode":"remote","url":"https://box.ts.net"}')).toEqual({ mode: 'remote', url: 'https://box.ts.net/' })
    expect(parseDesktopConnection('{"mode":"remote","url":"ftp://box"}')).toBeUndefined()
    expect(parseDesktopConnection('{"mode":"remote"}')).toBeUndefined()
    expect(parseDesktopConnection('null')).toBeUndefined()
    expect(parseDesktopConnection('{')).toBeUndefined()
  })

  it('round-trips through the file and defaults to the local Host', async () => {
    const root = userData()
    expect(await readDesktopConnection(root, {})).toEqual({ mode: 'local' })
    await writeDesktopConnection(root, { mode: 'remote', url: 'https://box.ts.net/' })
    expect(JSON.parse(readFileSync(desktopConnectionPath(root), 'utf8'))).toEqual({ mode: 'remote', url: 'https://box.ts.net/' })
    expect(await readDesktopConnection(root, {})).toEqual({ mode: 'remote', url: 'https://box.ts.net/' })
  })

  it('falls back to the local Host for an invalid or unreadable file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => { warn.mockRestore() })
    const root = userData()
    mkdirSync(dirname(desktopConnectionPath(root)), { recursive: true })
    writeFileSync(desktopConnectionPath(root), '{"mode":"remote","url":"nope"}')
    expect(await readDesktopConnection(root, {})).toEqual({ mode: 'local' })
    rmSync(desktopConnectionPath(root))
    mkdirSync(desktopConnectionPath(root))
    expect(await readDesktopConnection(root, {})).toEqual({ mode: 'local' })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('lets DSH_DESKTOP_SERVER_URL override the file and rejects an invalid override', async () => {
    const root = userData()
    await writeDesktopConnection(root, { mode: 'local' })
    expect(await readDesktopConnection(root, { DSH_DESKTOP_SERVER_URL: 'https://box.ts.net' })).toEqual({ mode: 'remote', url: 'https://box.ts.net/' })
    expect(await readDesktopConnection(root, { DSH_DESKTOP_SERVER_URL: '' })).toEqual({ mode: 'local' })
    await expect(readDesktopConnection(root, { DSH_DESKTOP_SERVER_URL: 'box' })).rejects.toThrow(/DSH_DESKTOP_SERVER_URL/)
  })
})

describe('connection pages', () => {
  it('decodes every intent the pages produce and ignores other navigations', () => {
    expect(parseConnectionIntent('dsh-connect://connect?url=https%3A%2F%2Fbox.ts.net')).toEqual({ kind: 'connect', url: 'https://box.ts.net/' })
    expect(parseConnectionIntent('dsh-connect://connect?url=nope')).toEqual({ kind: 'connect', url: undefined })
    expect(parseConnectionIntent('dsh-connect://connect')).toEqual({ kind: 'connect', url: undefined })
    expect(parseConnectionIntent('dsh-connect://local')).toEqual({ kind: 'local' })
    expect(parseConnectionIntent('dsh-connect://cancel')).toEqual({ kind: 'cancel' })
    expect(parseConnectionIntent('dsh-connect://other')).toBeUndefined()
    expect(parseConnectionIntent('https://box.ts.net/')).toBeUndefined()
    expect(parseConnectionIntent('not a url')).toBeUndefined()
  })

  it('prefills the remote address, escapes copy, and links every choice', () => {
    const page = pageText(connectionPageUrl(en, { mode: 'remote', url: 'https://box.ts.net/"><x>' }, en.connectionInvalidUrl))
    expect(page).toContain('value="https://box.ts.net/&quot;&gt;&lt;x&gt;"')
    expect(page).toContain(en.connectionInvalidUrl)
    expect(page).toContain('action="dsh-connect://connect"')
    expect(page).toContain('href="dsh-connect://local"')
    expect(page).toContain('href="dsh-connect://cancel"')
    expect(pageText(connectionPageUrl(en, { mode: 'local' }))).toContain('value=""')
  })
})

describe('parseConnectionTarget', () => {
  it('accepts a local choice and normalizes a remote address', () => {
    expect(parseConnectionTarget({ mode: 'local' })).toEqual({ mode: 'local' })
    expect(parseConnectionTarget({ mode: 'remote', url: 'https://box.ts.net' })).toEqual({ mode: 'remote', url: 'https://box.ts.net/' })
  })

  it('rejects non-objects, unknown modes, and invalid addresses', () => {
    expect(parseConnectionTarget(null)).toBeUndefined()
    expect(parseConnectionTarget('local')).toBeUndefined()
    expect(parseConnectionTarget({ mode: 'other' })).toBeUndefined()
    expect(parseConnectionTarget({ mode: 'remote' })).toBeUndefined()
    expect(parseConnectionTarget({ mode: 'remote', url: 'ftp://box' })).toBeUndefined()
  })
})
