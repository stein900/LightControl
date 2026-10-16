import {
  app,
  dialog,
  nativeTheme,
  session,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'
import { Application } from './app/application'
import { FileLogger } from './core/logger'
import { registerIpc } from './ipc/register-ipc'
import { APP_ORIGIN, registerAppSchemePrivileges, serveRendererBundle } from './security/app-protocol'
import { createMainWindow } from './windows/main-window'
import { AppTray } from './windows/tray'
import { IpcEvent } from '@shared/ipc'

const APP_ID = 'app.lightcontrol.desktop'
const HIDDEN_FLAG = '--hidden'
const PREVIEW_INTERVAL_MS = 50

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerAppSchemePrivileges()
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_ID)
  await app.whenReady()

  const rendererUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (!rendererUrl) serveRendererBundle(join(__dirname, '../renderer'))
  const entryUrl = rendererUrl ?? `${APP_ORIGIN}/index.html`
  const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const icons = {
    window: join(resources, 'icons', 'icon.ico'),
    tray: join(resources, 'icons', 'tray.ico')
  }

  const fileLogger = new FileLogger(
    join(app.getPath('userData'), 'logs'),
    rendererUrl ? 'debug' : 'info',
    !app.isPackaged
  )
  fileLogger.open()
  const logger = fileLogger.scope('main')
  logger.info(`LightControl ${app.getVersion()} starting (Electron ${process.versions.electron})`)

  // Deny every permission request (camera, notifications, ...): the UI needs none.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

  const application = new Application(
    app.getVersion(),
    {
      userData: app.getPath('userData'),
      logs: fileLogger.directory,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      mainDirectory: __dirname
    },
    fileLogger,
    {
      setTheme: (theme) => {
        nativeTheme.themeSource = theme
      },
      setLaunchAtLogin: (enabled) => {
        // Registering the development binary would start a bare Electron at login.
        if (!app.isPackaged) return
        app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] })
      }
    }
  )

  let window: BrowserWindow | null = null
  let quitting = false
  const trustedOrigin = new URL(entryUrl).origin

  const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url
    return !!url && new URL(url).origin === trustedOrigin
  }

  const showWindow = (): void => {
    if (!window || window.isDestroyed()) window = openWindow(true)
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  const openWindow = (show: boolean): BrowserWindow => {
    const created = createMainWindow({
      preload: join(__dirname, '../preload/index.js'),
      url: entryUrl,
      devTools: !app.isPackaged,
      icon: icons.window,
      show
    })
    created.on('close', (event) => {
      if (!quitting && application.settings.get().closeToTray) {
        event.preventDefault()
        created.hide()
      }
    })
    created.on('closed', () => {
      if (window === created) window = null
    })
    return created
  }

  const quit = (): void => {
    quitting = true
    app.quit()
  }

  registerIpc({
    app: application,
    logger: fileLogger.scope('ipc'),
    isTrustedSender,
    openExternal: (url) => shell.openExternal(url),
    openLogs: async () => {
      await shell.openPath(fileLogger.directory)
    },
    chooseExecutable: async () => {
      const options = {
        title: 'Emplacement de OpenRGB.exe',
        properties: ['openFile' as const],
        filters: [{ name: 'OpenRGB', extensions: ['exe'] }]
      }
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  const tray = new AppTray(icons.tray, {
    show: showWindow,
    quit,
    setPower: (on) => application.setPower(on),
    setSync: (enabled) => application.setSync(enabled),
    applyProfile: (id) => application.applyProfile(id)
  })

  application.events.on('snapshot', (snapshot) => {
    tray.update(snapshot)
    if (window && !window.isDestroyed()) window.webContents.send(IpcEvent.snapshot, snapshot)
  })

  // Live LED preview, only while the window is actually visible.
  const preview = setInterval(() => {
    if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) return
    window.webContents.send(IpcEvent.frames, application.frames())
  }, PREVIEW_INTERVAL_MS)

  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => {
    if (!application.settings.get().closeToTray) quit()
  })

  let shutdownComplete = false
  app.on('before-quit', (event) => {
    quitting = true
    if (shutdownComplete) return
    event.preventDefault()
    clearInterval(preview)
    tray.destroy()
    void application
      .shutdown()
      .catch((error: unknown) => logger.error('Shutdown failed', error))
      .finally(() => {
        logger.info('Stopped')
        fileLogger.close()
        shutdownComplete = true
        app.quit()
      })
  })

  application.start()
  tray.update(application.snapshot())

  const startHidden = process.argv.includes(HIDDEN_FLAG) || application.settings.get().startMinimized
  window = openWindow(!startHidden)
}
