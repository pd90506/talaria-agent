/** Isolated bridge for a remote server's Web application: only the Desktop connection choice. */
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopConnectionChangeResult, DesktopConnectionTarget } from '@deepseek-ai/dsh-client-ui-settings-general/types'
import { DESKTOP_IPC, REMOTE_ORIGIN_ARGUMENT } from './ipc.ts'

const origin = process.argv.find(argument => argument.startsWith(REMOTE_ORIGIN_ARGUMENT))?.slice(REMOTE_ORIGIN_ARGUMENT.length)
if (origin !== undefined && location.origin === origin && process.isMainFrame) {
  contextBridge.exposeInMainWorld('dshDesktop', {
    protocolVersion: 1,
    connection: {
      get: () => ipcRenderer.invoke(DESKTOP_IPC.connectionGet) as Promise<DesktopConnectionTarget>,
      set: (target: DesktopConnectionTarget) =>
        ipcRenderer.invoke(DESKTOP_IPC.connectionSet, target) as Promise<DesktopConnectionChangeResult>,
    },
  })
}
