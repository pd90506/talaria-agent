/** Connection choice: the chooser window and the Settings IPC that store a target and restart Desktop into it. */
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { DesktopConnectionChangeResult, DesktopConnectionTarget } from '@deepseek-ai/dsh-client-ui-settings-general/types'
import { DESKTOP_IPC } from './ipc.ts'
import type { DesktopMessages } from './locale.ts'
import {
  connectionPageUrl,
  parseConnectionIntent,
  parseConnectionTarget,
  writeDesktopConnection,
  type DesktopConnection,
} from './remote-connection.ts'

/**
 * Create the hidden chooser window; it loads only the local connection page.
 * @returns the window.
 */
function chooserWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 520,
    height: 320,
    minWidth: 420,
    minHeight: 280,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
}

/**
 * Store a new connection and restart Desktop through the ordinary quit, so a local Host stops cleanly first.
 * @param userData - Electron userData.
 * @param connection - the chosen target.
 */
async function switchConnection(userData: string, connection: DesktopConnection): Promise<void> {
  await writeDesktopConnection(userData, connection)
  restartIntoConnection()
}

/** Restart Desktop so the next launch reads the stored connection. */
function restartIntoConnection(): void {
  // The relaunched process inherits this environment; an explicit choice replaces the launch override.
  delete process.env.DSH_DESKTOP_SERVER_URL
  app.relaunch()
  app.quit()
}

/**
 * Serve the Settings connection bridge. A saved choice is reported before Desktop restarts into it.
 * @param options - the connection in use, Electron userData, and the sender check for this mode.
 * @param options.current - the connection this run uses.
 * @param options.userData - Electron userData.
 * @param options.assertSender - rejects IPC from any frame other than the owned application document.
 */
export function handleConnectionIpc(options: {
  current: DesktopConnection
  userData: string
  assertSender: (event: IpcMainInvokeEvent) => void
}): void {
  ipcMain.handle(DESKTOP_IPC.connectionGet, (event): DesktopConnectionTarget => {
    options.assertSender(event)
    return options.current
  })
  ipcMain.handle(DESKTOP_IPC.connectionSet, async (event, value: unknown): Promise<DesktopConnectionChangeResult> => {
    options.assertSender(event)
    const target = parseConnectionTarget(value)
    if (target === undefined) return { kind: 'invalid-url' }
    await writeDesktopConnection(options.userData, target)
    // Let the reply reach the renderer before the quit closes its window.
    setTimeout(restartIntoConnection, 200)
    return { kind: 'saved' }
  })
}

/**
 * Show the connection chooser. Choosing a server or the local Host stores it and restarts Desktop.
 * @param options - localized copy, the active connection, and Electron userData.
 * @param options.messages - localized shell copy.
 * @param options.current - the connection in use.
 * @param options.userData - Electron userData.
 * @param options.parent - window the chooser attaches to, if any.
 * @param options.error - message shown above the actions, such as an unreachable server.
 * @returns the chooser window.
 */
export function showConnectionWindow(options: {
  messages: () => DesktopMessages
  current: DesktopConnection
  userData: string
  parent?: BrowserWindow | undefined
  error?: string | undefined
}): BrowserWindow {
  const window = chooserWindow()
  if (options.parent !== undefined && !options.parent.isDestroyed()) window.setParentWindow(options.parent)
  window.setMenuBarVisibility(false)
  window.webContents.on('will-navigate', (event, href) => {
    const intent = parseConnectionIntent(href)
    event.preventDefault()
    if (intent === undefined) return
    switch (intent.kind) {
      case 'connect':
        if (intent.url === undefined) {
          void window.loadURL(connectionPageUrl(options.messages(), options.current, options.messages().connectionInvalidUrl))
          return
        }
        void switchConnection(options.userData, { mode: 'remote', url: intent.url }).catch((error: unknown) => { console.error(error) })
        return
      case 'local':
        void switchConnection(options.userData, { mode: 'local' }).catch((error: unknown) => { console.error(error) })
        return
      case 'cancel':
        window.close()
        return
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.once('ready-to-show', () => { window.show() })
  void window.loadURL(connectionPageUrl(options.messages(), options.current, options.error))
  return window
}
