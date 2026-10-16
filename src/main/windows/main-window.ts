import { BrowserWindow, nativeTheme, shell } from 'electron'

/** Native caption buttons stop one pixel above the title bar's bottom border so it stays continuous. */
export const TITLE_BAR_HEIGHT = 39

const PALETTE = {
  dark: { background: '#0A0A0A', symbol: '#A1A1A1' },
  light: { background: '#FAFAFA', symbol: '#525252' }
} as const

function palette(): (typeof PALETTE)[keyof typeof PALETTE] {
  return nativeTheme.shouldUseDarkColors ? PALETTE.dark : PALETTE.light
}

export interface MainWindowOptions {
  preload: string
  /** Vite dev server in development, the app:// bundle once packaged. */
  url: string
  devTools: boolean
  icon: string
  show: boolean
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const colors = palette()
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'LightControl',
    icon: options.icon,
    backgroundColor: colors.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT },
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: options.devTools
    }
  })

  const syncTitleBar = (): void => {
    if (window.isDestroyed()) return
    const next = palette()
    window.setBackgroundColor(next.background)
    window.setTitleBarOverlay({ color: next.background, symbolColor: next.symbol, height: TITLE_BAR_HEIGHT })
  }
  nativeTheme.on('updated', syncTitleBar)
  window.on('closed', () => nativeTheme.off('updated', syncTitleBar))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  window.once('ready-to-show', () => {
    if (options.show) window.show()
  })

  void window.loadURL(options.url)

  return window
}
