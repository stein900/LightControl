import { RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/controls'
import { Banner } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { run, useAppStore, useSnapshot } from '@renderer/store/app-store'

/** Shown whenever the hardware engine is not connected. */
export function EngineBanner() {
  const { engine } = useSnapshot()
  const navigate = useAppStore((state) => state.navigate)
  if (engine.state === 'connected') return null

  if (engine.state === 'error') {
    return (
      <Banner
        tone="danger"
        title="Le moteur matériel ne répond pas"
        actions={
          <>
            <Button size="sm" onClick={() => navigate({ page: 'diagnostics' })}>
              Diagnostic
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<RotateCcw size={14} />}
              onClick={() => void run(() => api.reconnectEngine())}
            >
              Relancer
            </Button>
          </>
        }
      >
        {engine.message ?? 'La connexion au moteur OpenRGB a échoué.'}
      </Banner>
    )
  }

  return (
    <Banner tone="info" title="Connexion au matériel">
      {engine.message ?? 'Démarrage du moteur OpenRGB et détection des appareils…'}
    </Banner>
  )
}
