import type { DeviceKind } from '@shared/model'
import { KINDS } from '@renderer/lib/labels'

export function KindIcon({ kind, size = 16 }: { kind: DeviceKind; size?: number }) {
  const Icon = KINDS[kind].icon
  return <Icon size={size} strokeWidth={1.75} />
}
