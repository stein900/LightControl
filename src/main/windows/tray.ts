import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { AppSnapshot } from '@shared/model'

export interface TrayActions {
  show(): void
  quit(): void
  setPower(on: boolean): void
  setSync(enabled: boolean): void
  applyProfile(id: string): void
}

/** Notification-area icon with quick lighting controls. */
export class AppTray {
  private readonly tray: Tray
  private lastMenuKey = ''

  constructor(
    icon: string,
    private readonly actions: TrayActions
  ) {
    this.tray = new Tray(nativeImage.createFromPath(icon))
    this.tray.setToolTip('LightControl')
    this.tray.on('click', () => actions.show())
  }

  update(snapshot: AppSnapshot): void {
    const key = JSON.stringify([
      snapshot.lighting.power,
      snapshot.lighting.sync,
      snapshot.activeProfileId,
      snapshot.profiles.map((profile) => [profile.id, profile.name]),
      snapshot.engine.state
    ])
    if (key === this.lastMenuKey) return
    this.lastMenuKey = key

    const connected = snapshot.engine.state === 'connected'
    const profiles: MenuItemConstructorOptions[] = snapshot.profiles.map((profile) => ({
      label: profile.name,
      type: 'radio',
      checked: profile.id === snapshot.activeProfileId,
      click: () => this.actions.applyProfile(profile.id)
    }))

    const template: MenuItemConstructorOptions[] = [
      { label: 'Ouvrir LightControl', click: () => this.actions.show() },
      { type: 'separator' },
      {
        label: 'Éclairage allumé',
        type: 'checkbox',
        checked: snapshot.lighting.power,
        enabled: connected,
        click: (item) => this.actions.setPower(item.checked)
      },
      {
        label: 'Synchroniser tous les appareils',
        type: 'checkbox',
        checked: snapshot.lighting.sync,
        enabled: connected,
        click: (item) => this.actions.setSync(item.checked)
      },
      {
        label: 'Profils',
        enabled: profiles.length > 0,
        submenu: profiles.length > 0 ? profiles : [{ label: 'Aucun profil', enabled: false }]
      },
      { type: 'separator' },
      { label: 'Quitter', click: () => this.actions.quit() }
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
    this.tray.setToolTip(connected ? 'LightControl' : 'LightControl · moteur déconnecté')
  }

  destroy(): void {
    this.tray.destroy()
  }
}
