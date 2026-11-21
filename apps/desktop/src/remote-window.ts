/** Remote connection mode: one window showing a dsh server's Web application, and the connection chooser. */
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, shell, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import type { DesktopConnectionChangeResult, DesktopConnectionTarget } from '@deepseek-ai/dsh-client-ui-settings-general/types'
import { DESKTOP_IPC, REMOTE_ORIGIN_ARGUMENT } from './ipc.ts'
import type { DesktopMessages } from './locale.ts'
import {
  connectionPageUrl,
  parseConnectionIntent,
  parseConnectionTarget,
  remoteFailurePageUrl,
  writeDesktopConnection,
  type DesktopConnection,
} from './remote-connection.ts'

/**
 * Window options shared by the remote application and the connection chooser.
 * @param width - initial width.
 * @param height - initial height.
 * @param remoteOrigin - server origin that may receive the connection-only preload bridge; omitted for the chooser.
 * @returns the hidden window.
 */
function plainWindow(width: number, height: number, remoteOrigin?: string): BrowserWindow {
  return new BrowserWindow({
    width,
    height,
    minWidth: 420,
    minHeight: 320,
    show: false,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      ...remoteOrigin === undefined ? {} : {
        preload: fileURLToPath(new URL('./preload-remote.cjs', import.meta.url)),
        additionalArguments: [`${REMOTE_ORIGIN_ARGUMENT}${remoteOrigin}`],
      },
    },
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
 * @returns the chooser window.
 */
export function showConnectionWindow(options: {
  messages: () => DesktopMessages
  current: DesktopConnection
  userData: string
  parent?: BrowserWindow | undefined
}): BrowserWindow {
  const window = plainWindow(520, 300)
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
      case 'edit':
      case 'retry':
        return
      case 'cancel':
        window.close()
        return
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.once('ready-to-show', () => { window.show() })
  void window.loadURL(connectionPageUrl(options.messages(), options.current))
  return window
}

/**
 * Run Desktop against a remote dsh server: no local Host starts, and the window loads the server's Web application.
 * Authentication belongs to the server, such as Tailscale identity behind `tailscale serve`.
 * @param options - localized copy, the server address, and Electron userData.
 * @param options.messages - localized shell copy.
 * @param options.url - normalized server application root.
 * @param options.userData - Electron userData.
 */
export function runRemoteDesktop(options: {
  messages: () => DesktopMessages
  url: string
  userData: string
}): void {
  const current: DesktopConnection = { mode: 'remote', url: options.url }
  const origin = new URL(options.url).origin
  let window: BrowserWindow | undefined
  const chooser = (): void => {
    showConnectionWindow({ messages: options.messages, current, userData: options.userData, parent: window })
  }
  const load = (target: BrowserWindow): void => {
    void target.loadURL(options.url).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED') return
      console.error(error)
    })
  }
  handleConnectionIpc({ current, userData: options.userData, assertSender: (event) => {
    const frame = event.senderFrame
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents || frame === null
      || frame !== window.webContents.mainFrame || new URL(frame.url).origin !== origin) {
      throw new Error('desktop connection: rejected IPC from an unowned renderer')
    }
  } })
  const open = (): BrowserWindow => {
    const next = plainWindow(1280, 820, origin)
    next.webContents.setWindowOpenHandler(({ url }) => {
      if (['http:', 'https:'].includes(new URL(url).protocol)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    next.webContents.on('will-navigate', (event, href) => {
      const intent = parseConnectionIntent(href)
      if (intent !== undefined) {
        event.preventDefault()
        if (intent.kind === 'retry') load(next)
        else if (intent.kind === 'local') void switchConnection(options.userData, { mode: 'local' }).catch((error: unknown) => { console.error(error) })
        else chooser()
        return
      }
      if (new URL(href).origin === origin) return
      event.preventDefault()
      if (['http:', 'https:'].includes(new URL(href).protocol)) void shell.openExternal(href)
    })
    next.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 || new URL(failedUrl).origin !== origin) return
      void next.loadURL(remoteFailurePageUrl(options.messages(), options.url, `${description} (${String(code)})`))
    })
    next.once('ready-to-show', () => { next.show() })
    load(next)
    return next
  }
  const messages = options.messages()
  const darwin = process.platform === 'darwin'
  const connectionItems: MenuItemConstructorOptions[] = [
    { label: messages.connectServerMenu, click: chooser },
    { label: messages.connectionUseLocal, click: () => { void switchConnection(options.userData, { mode: 'local' }).catch((error: unknown) => { console.error(error) }) } },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...darwin ? [{ role: 'appMenu' as const }] : [],
    { label: messages.fileMenu, submenu: [...connectionItems, { type: 'separator' }, darwin ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
  app.on('activate', () => {
    if (window === undefined || window.isDestroyed()) window = open()
    else window.show()
  })
  window = open()
}
