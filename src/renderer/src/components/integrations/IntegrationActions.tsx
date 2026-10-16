import { ShieldCheck, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { IntegrationAction, IntegrationStatus } from '@shared/model'
import { Button, type ButtonProps } from '@renderer/components/ui/controls'
import { api } from '@renderer/lib/api'
import { run } from '@renderer/store/app-store'

const ACTIONS: Record<IntegrationAction, { label: string; icon: typeof ShieldCheck; success: string }> = {
  'take-over': {
    label: 'Prendre le contrôle',
    icon: ShieldCheck,
    success: 'LightControl pilote maintenant vos appareils Lian Li.'
  },
  'hand-back': {
    label: 'Rendre la main',
    icon: Undo2,
    success: 'L-Connect 3 a été rétabli.'
  }
}

/** Buttons for the actions an integration offers; each one may show a Windows administrator prompt. */
export function IntegrationActions({
  integration,
  variant
}: {
  integration: IntegrationStatus
  variant?: ButtonProps['variant']
}) {
  const [busy, setBusy] = useState(false)
  return (
    <>
      {integration.actions.map((action) => {
        const { label, icon: Icon, success } = ACTIONS[action]
        return (
          <Button
            key={action}
            size="sm"
            variant={action === 'take-over' ? (variant ?? 'primary') : 'secondary'}
            icon={<Icon size={14} />}
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void run(() => api.runIntegrationAction(integration.id, action), success).finally(() =>
                setBusy(false)
              )
            }}
          >
            {label}
          </Button>
        )
      })}
    </>
  )
}
