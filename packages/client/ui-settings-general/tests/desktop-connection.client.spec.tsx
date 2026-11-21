// @vitest-environment jsdom
/** Settings row for the Desktop server connection: current target, validation, and save outcomes. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { DesktopConnectionRow } from '../src/client/DesktopConnectionRow.tsx'
import { en } from '../src/client/locales.ts'
import type { DesktopConnectionBridge, DesktopConnectionChangeResult, DesktopConnectionTarget } from '../src/types.ts'

afterEach(() => { cleanup() })

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const unusedHook = (() => { throw new Error('unused by the connection row') }) as never
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook, usePanelInfo: unusedHook, useSessionRetainInfo: () => undefined,
  useResource, useWorkspaces: unusedHook, ...allowAllAccess, useContextMenu: contextMenuHook(),
}
const t = ((key: string, params?: Record<string, string>) => {
  const text = (en as Record<string, string>)[key] ?? key
  return text.replace(/\{(\w+)\}/gu, (_match, name: string) => params?.[name] ?? '')
}) as never

function bridge(current: DesktopConnectionTarget, result: DesktopConnectionChangeResult | Error = { kind: 'saved' }) {
  const set = vi.fn(async (_target: DesktopConnectionTarget) => {
    if (result instanceof Error) throw result
    return result
  })
  const connection: DesktopConnectionBridge = { get: async () => current, set }
  return { connection, set }
}

it('shows the local target and connects to a remote address', async () => {
  const { connection, set } = bridge({ mode: 'local' })
  render(<DesktopConnectionRow {...kit} t={t} connection={connection} />)
  await screen.findByText('Current: running on this computer')
  expect(screen.getByRole('button', { name: 'Run on this computer' })).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Server address' }), { target: { value: 'https://box.ts.net' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await screen.findByText('Restarting to apply the new connection…')
  expect(set).toHaveBeenCalledExactlyOnceWith({ mode: 'remote', url: 'https://box.ts.net' })
  expect(screen.getByRole('button', { name: 'Connect' })).toHaveProperty('disabled', true)
})

it('prefills the remote address and switches back to this computer', async () => {
  const { connection, set } = bridge({ mode: 'remote', url: 'https://box.ts.net/' })
  render(<DesktopConnectionRow {...kit} t={t} connection={connection} />)
  await screen.findByText('Current: connected to https://box.ts.net/')
  expect(screen.getByRole('textbox', { name: 'Server address' })).toHaveProperty('value', 'https://box.ts.net/')
  fireEvent.click(screen.getByRole('button', { name: 'Run on this computer' }))
  await waitFor(() => { expect(set).toHaveBeenCalledExactlyOnceWith({ mode: 'local' }) })
})

it('reports an invalid address until the address changes', async () => {
  const { connection } = bridge({ mode: 'local' }, { kind: 'invalid-url' })
  render(<DesktopConnectionRow {...kit} t={t} connection={connection} />)
  const field = await screen.findByRole('textbox', { name: 'Server address' })
  fireEvent.change(field, { target: { value: 'ftp://box.ts.net' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Enter an http or https address.')
  fireEvent.change(field, { target: { value: 'https://box.ts.net' } })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('reports read and save failures', async () => {
  const unreadable: DesktopConnectionBridge = { get: async () => { throw new Error('ipc') }, set: vi.fn() }
  const view = render(<DesktopConnectionRow {...kit} t={t} connection={unreadable} />)
  expect((await screen.findByRole('alert')).textContent).toBe('The connection setting could not be read or saved.')
  view.unmount()
  const { connection } = bridge({ mode: 'local' }, new Error('ipc'))
  render(<DesktopConnectionRow {...kit} t={t} connection={connection} />)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Server address' }), { target: { value: 'https://box.ts.net' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect((await screen.findByRole('alert')).textContent).toBe('The connection setting could not be read or saved.')
})

it('ignores a connection read that settles after the row unmounts', async () => {
  const resolved = Promise.withResolvers<DesktopConnectionTarget>()
  const rejected = Promise.withResolvers<DesktopConnectionTarget>()
  const first = render(<DesktopConnectionRow {...kit} t={t} connection={{ get: () => resolved.promise, set: vi.fn() }} />)
  const second = render(<DesktopConnectionRow {...kit} t={t} connection={{ get: () => rejected.promise, set: vi.fn() }} />)
  first.unmount()
  second.unmount()
  resolved.resolve({ mode: 'remote', url: 'https://box.ts.net/' })
  rejected.reject(new Error('ipc'))
  await Promise.allSettled([resolved.promise, rejected.promise])
  expect(screen.queryByRole('group')).toBeNull()
})
