/** Remote server stand-in for the bundled Host: startup injections and the local operations it declines. */
import { describe, expect, it, vi } from 'vitest'
import { DesktopRemoteHost, readRemoteBoot } from '../src/remote-host.ts'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('readRemoteBoot', () => {
  it('reads the injection rows from the server boot route without following redirects', async () => {
    const send = vi.fn(async (_input: string, _init?: RequestInit) => ok({ injections: [{ kind: 'global', name: 'x', value: 1 }] }))
    expect(await readRemoteBoot('https://box.ts.net/', send)).toEqual([{ kind: 'global', name: 'x', value: 1 }])
    expect(send).toHaveBeenCalledWith('https://box.ts.net/desktop/boot', expect.objectContaining({ redirect: 'error' }))
  })

  it('names the server in refusal and malformed-response failures', async () => {
    await expect(readRemoteBoot('https://box.ts.net/', async () => new Response(null, { status: 401 }))).rejects.toThrow(/answered 401/)
    await expect(readRemoteBoot('https://box.ts.net/', async () => ok({}))).rejects.toThrow(/no startup injections/)
    await expect(readRemoteBoot('https://box.ts.net/', async () => ok(null))).rejects.toThrow(/no startup injections/)
  })

  it('cancels a pending read', async () => {
    const controller = new AbortController()
    const send = (_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('stopped')) })
    })
    const reading = readRemoteBoot('https://box.ts.net/', send, controller.signal)
    controller.abort(new Error('stopped'))
    await expect(reading).rejects.toThrow('stopped')
  })
})

describe('DesktopRemoteHost', () => {
  it('starts with the server root and no local cookie, and declines local-only work', async () => {
    const host = new DesktopRemoteHost('https://box.ts.net/', async () => ok({ injections: [] }))
    expect(await host.start()).toEqual({ url: 'https://box.ts.net/', injections: [], authenticationCookie: '' })
    expect(await host.updateTasks('inspect')).toBe(false)
    expect(await host.inspectQuit()).toEqual({ activeTasks: false, scheduledTasks: false })
    expect(await host.resolveDragResource('file://x')).toBeNull()
    await host.stop()
  })

  it('aborts a pending startup on stop', async () => {
    const host = new DesktopRemoteHost('https://box.ts.net/', (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    const starting = host.start()
    await host.stop()
    await expect(starting).rejects.toThrow('aborted')
  })
})
