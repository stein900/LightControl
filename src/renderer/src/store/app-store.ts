import { create } from 'zustand'
import type { AppSnapshot } from '@shared/model'
import { errorMessage } from '@renderer/lib/api'

export type Route =
  | { page: 'overview' }
  | { page: 'device'; deviceId: string }
  | { page: 'profiles' }
  | { page: 'settings' }
  | { page: 'diagnostics' }

export type ToastTone = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface AppStore {
  snapshot: AppSnapshot | null
  route: Route
  toasts: Toast[]
  setSnapshot(snapshot: AppSnapshot): void
  navigate(route: Route): void
  notify(tone: ToastTone, message: string): void
  dismiss(id: number): void
}

let nextToastId = 1
const TOAST_DURATION_MS = 4500

export const useAppStore = create<AppStore>((set, get) => ({
  snapshot: null,
  route: { page: 'overview' },
  toasts: [],
  setSnapshot: (snapshot) => {
    const { route } = get()
    // Leave a device page whose device disappeared.
    if (route.page === 'device' && !snapshot.devices.some((device) => device.id === route.deviceId)) {
      set({ snapshot, route: { page: 'overview' } })
      return
    }
    set({ snapshot })
  },
  navigate: (route) => set({ route }),
  notify: (tone, message) => {
    const id = nextToastId++
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, tone, message }] }))
    setTimeout(() => get().dismiss(id), TOAST_DURATION_MS)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}))

/** Runs an IPC command and reports failures as a toast. */
export async function run<T>(task: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const result = await task()
    if (success) useAppStore.getState().notify('success', success)
    return result
  } catch (error) {
    useAppStore.getState().notify('error', errorMessage(error))
    return undefined
  }
}

export function useSnapshot(): AppSnapshot {
  const snapshot = useAppStore((state) => state.snapshot)
  if (!snapshot) throw new Error('Snapshot not loaded')
  return snapshot
}
