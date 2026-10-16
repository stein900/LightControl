/**
 * Sandboxed preload: exposes the typed LightControl API and nothing else.
 * The renderer never gets direct access to ipcRenderer or Node.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, IpcEvent, type LightControlApi } from '@shared/ipc'
import type { AppSnapshot, DeviceFrame } from '@shared/model'

const invoke = <T = void>(channel: string, payload?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, payload) as Promise<T>

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: LightControlApi = {
  getSnapshot: () => invoke<AppSnapshot>(IpcChannel.getSnapshot),

  setPower: (on) => invoke(IpcChannel.setPower, on),
  setBrightness: (value) => invoke(IpcChannel.setBrightness, value),
  setSync: (enabled) => invoke(IpcChannel.setSync, enabled),
  setSyncEffect: (effect) => invoke(IpcChannel.setSyncEffect, effect),
  setZoneEffect: (deviceId, zoneIndex, effect) =>
    invoke(IpcChannel.setZoneEffect, { deviceId, zoneIndex, effect }),
  setDeviceControl: (deviceId, control) => invoke(IpcChannel.setDeviceControl, { deviceId, control }),
  setFollowSync: (deviceId, followSync) => invoke(IpcChannel.setFollowSync, { deviceId, followSync }),
  setHardwareMode: (deviceId, mode, persist) =>
    invoke(IpcChannel.setHardwareMode, { deviceId, mode, persist }),
  identify: (deviceId, zoneIndex) => invoke(IpcChannel.identify, { deviceId, zoneIndex }),

  setWhiteBalance: (deviceId, whiteBalance) => invoke(IpcChannel.setWhiteBalance, { deviceId, whiteBalance }),
  setWhiteTest: (deviceId, enabled) => invoke(IpcChannel.setWhiteTest, { deviceId, enabled }),
  setZoneSize: (deviceId, zoneIndex, size) => invoke(IpcChannel.setZoneSize, { deviceId, zoneIndex, size }),
  setAlias: (deviceId, zoneIndex, alias) => invoke(IpcChannel.setAlias, { deviceId, zoneIndex, alias }),

  createProfile: (name) => invoke<string>(IpcChannel.createProfile, name),
  saveProfile: (id) => invoke(IpcChannel.saveProfile, id),
  applyProfile: (id) => invoke(IpcChannel.applyProfile, id),
  renameProfile: (id, name) => invoke(IpcChannel.renameProfile, { id, name }),
  deleteProfile: (id) => invoke(IpcChannel.deleteProfile, id),

  updateSettings: (patch) => invoke(IpcChannel.updateSettings, patch),

  reconnectEngine: () => invoke(IpcChannel.reconnectEngine),
  rescanDevices: () => invoke(IpcChannel.rescanDevices),
  refreshDiagnostics: () => invoke(IpcChannel.refreshDiagnostics),
  runIntegrationAction: (id, action) => invoke(IpcChannel.runIntegrationAction, { id, action }),

  openExternal: (url) => invoke(IpcChannel.openExternal, url),
  openLogs: () => invoke(IpcChannel.openLogs),
  chooseExecutable: () => invoke<string | null>(IpcChannel.chooseExecutable),

  onSnapshot: (listener) => subscribe<AppSnapshot>(IpcEvent.snapshot, listener),
  onFrames: (listener) => subscribe<DeviceFrame[]>(IpcEvent.frames, listener)
}

contextBridge.exposeInMainWorld('lightcontrol', api)
