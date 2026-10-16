import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z, ZodError } from 'zod'
import type { Application } from '@main/app/application'
import { UserFacingError } from '@main/app/application'
import type { Logger } from '@main/core/logger'
import { ProfileNotFoundError } from '@main/services/profile-service'
import { IpcChannel } from '@shared/ipc'
import {
  EffectConfigSchema,
  ExternalUrlSchema,
  IdentifySchema,
  IntegrationActionSchema,
  ProfileIdSchema,
  ProfileNameSchema,
  ProfileRenameSchema,
  SetAliasSchema,
  SetDeviceControlSchema,
  SetFollowSyncSchema,
  SetHardwareModeSchema,
  SetWhiteBalanceSchema,
  SetWhiteTestSchema,
  SetZoneEffectSchema,
  SetZoneSizeSchema,
  SettingsPatchSchema
} from '@shared/schemas'

/** Hosts the renderer may open in the system browser. */
const EXTERNAL_HOSTS = new Set(['pawnio.eu', 'openrgb.org', 'codeberg.org', 'github.com'])

export interface IpcDependencies {
  app: Application
  logger: Logger
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  openExternal(url: string): Promise<void>
  openLogs(): Promise<void>
  chooseExecutable(): Promise<string | null>
}

const None = z.undefined()

export function registerIpc(deps: IpcDependencies): void {
  const { app, logger } = deps

  function handle<S extends z.ZodType>(
    channel: string,
    schema: S,
    run: (input: z.output<S>) => unknown
  ): void {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!deps.isTrustedSender(event)) {
        logger.warn(`Rejected IPC from untrusted sender on ${channel}`)
        throw new Error('Untrusted sender')
      }
      const parsed = schema.safeParse(payload)
      if (!parsed.success) {
        logger.warn(`Invalid payload on ${channel}`, parsed.error.issues.slice(0, 3))
        throw new Error('Requête invalide.')
      }
      try {
        return await run(parsed.data)
      } catch (error) {
        if (error instanceof UserFacingError) throw new Error(error.message, { cause: error })
        if (error instanceof ProfileNotFoundError)
          throw new Error('Ce profil n’existe plus.', { cause: error })
        if (error instanceof ZodError) throw new Error('Valeur invalide.', { cause: error })
        logger.error(`IPC ${channel} failed`, error)
        throw new Error('Une erreur inattendue est survenue. Le détail est dans le journal.', {
          cause: error
        })
      }
    })
  }

  handle(IpcChannel.getSnapshot, None, () => app.snapshot())

  handle(IpcChannel.setPower, z.boolean(), (on) => app.setPower(on))
  handle(IpcChannel.setBrightness, z.number().min(0).max(100), (value) => app.setBrightness(value))
  handle(IpcChannel.setSync, z.boolean(), (enabled) => app.setSync(enabled))
  handle(IpcChannel.setSyncEffect, EffectConfigSchema, (effect) => app.setSyncEffect(effect))
  handle(IpcChannel.setZoneEffect, SetZoneEffectSchema, ({ deviceId, zoneIndex, effect }) =>
    app.setZoneEffect(deviceId, zoneIndex, effect)
  )
  handle(IpcChannel.setDeviceControl, SetDeviceControlSchema, ({ deviceId, control }) =>
    app.setDeviceControl(deviceId, control)
  )
  handle(IpcChannel.setFollowSync, SetFollowSyncSchema, ({ deviceId, followSync }) =>
    app.setFollowSync(deviceId, followSync)
  )
  handle(IpcChannel.setHardwareMode, SetHardwareModeSchema, ({ deviceId, mode, persist }) =>
    app.setHardwareMode(deviceId, mode, persist)
  )
  handle(IpcChannel.identify, IdentifySchema, ({ deviceId, zoneIndex }) => app.identify(deviceId, zoneIndex))

  handle(IpcChannel.setWhiteBalance, SetWhiteBalanceSchema, ({ deviceId, whiteBalance }) =>
    app.setWhiteBalance(deviceId, whiteBalance)
  )
  handle(IpcChannel.setWhiteTest, SetWhiteTestSchema, ({ deviceId, enabled }) =>
    app.setWhiteTest(deviceId, enabled)
  )
  handle(IpcChannel.setZoneSize, SetZoneSizeSchema, ({ deviceId, zoneIndex, size }) =>
    app.setZoneSize(deviceId, zoneIndex, size)
  )
  handle(IpcChannel.setAlias, SetAliasSchema, ({ deviceId, zoneIndex, alias }) =>
    app.setAlias(deviceId, zoneIndex, alias)
  )

  handle(IpcChannel.createProfile, ProfileNameSchema, (name) => app.createProfile(name))
  handle(IpcChannel.saveProfile, ProfileIdSchema, (id) => app.saveProfile(id))
  handle(IpcChannel.applyProfile, ProfileIdSchema, (id) => app.applyProfile(id))
  handle(IpcChannel.renameProfile, ProfileRenameSchema, ({ id, name }) => app.renameProfile(id, name))
  handle(IpcChannel.deleteProfile, ProfileIdSchema, (id) => app.deleteProfile(id))

  handle(IpcChannel.updateSettings, SettingsPatchSchema, (patch) => app.updateSettings(patch))

  handle(IpcChannel.reconnectEngine, None, () => app.reconnectEngine())
  handle(IpcChannel.rescanDevices, None, () => app.rescanDevices())
  handle(IpcChannel.refreshDiagnostics, None, () => app.refreshDiagnostics())
  handle(IpcChannel.runIntegrationAction, IntegrationActionSchema, ({ id, action }) =>
    app.runIntegrationAction(id, action)
  )

  handle(IpcChannel.openExternal, ExternalUrlSchema, (url) => {
    if (!EXTERNAL_HOSTS.has(new URL(url).hostname)) throw new UserFacingError('Lien non autorisé.')
    return deps.openExternal(url)
  })
  handle(IpcChannel.openLogs, None, () => deps.openLogs())
  handle(IpcChannel.chooseExecutable, None, () => deps.chooseExecutable())
}
