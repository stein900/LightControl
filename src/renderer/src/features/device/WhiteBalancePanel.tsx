import { useEffect, useState } from 'react'
import { rgbToHex } from '@shared/color'
import type { AppSnapshot, DeviceInfo, WhiteBalance } from '@shared/model'
import { Button, Slider, Switch } from '@renderer/components/ui/controls'
import { Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { useThrottled } from '@renderer/lib/use-throttled'
import { run } from '@renderer/store/app-store'
import styles from './device.module.css'

const PRESETS: { label: string; value: WhiteBalance }[] = [
  { label: 'Neutre', value: { r: 100, g: 100, b: 100 } },
  { label: 'Corriger un blanc jaune', value: { r: 84, g: 90, b: 100 } },
  { label: 'Corriger un blanc rosé', value: { r: 86, g: 100, b: 96 } },
  { label: 'Corriger un blanc bleuté', value: { r: 100, g: 96, b: 84 } }
]

const CHANNELS = [
  { key: 'r', label: 'Rouge', color: '#ff4d4d' },
  { key: 'g', label: 'Vert', color: '#3ecf6e' },
  { key: 'b', label: 'Bleu', color: '#4d8dff' }
] as const

/**
 * Per-device channel gains. Many ARGB LEDs render "white" warm: blue needs the
 * highest voltage and fades first along a long chain. Lowering red and green
 * restores a neutral white.
 */
export function WhiteBalancePanel({ snapshot, device }: { snapshot: AppSnapshot; device: DeviceInfo }) {
  const stored = snapshot.deviceSettings[device.id]?.whiteBalance ?? { r: 100, g: 100, b: 100 }
  const [draft, setDraft] = useState(stored)
  const testing = snapshot.overlay?.kind === 'white-test' && snapshot.overlay.deviceId === device.id
  const commit = useThrottled(
    (value: WhiteBalance) => void run(() => api.setWhiteBalance(device.id, value)),
    60
  )

  useEffect(() => setDraft(stored), [stored.r, stored.g, stored.b]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (value: WhiteBalance): void => {
    setDraft(value)
    commit(value)
  }

  const level = snapshot.lighting.brightness / 100
  const preview = rgbToHex({
    r: Math.round(255 * (draft.r / 100)),
    g: Math.round(255 * (draft.g / 100)),
    b: Math.round(255 * (draft.b / 100))
  })

  return (
    <Section
      title="Balance des blancs"
      description="Corrige la teinte du blanc de cet appareil, pour tous les effets et modes. Si le blanc tire sur le jaune, baissez le rouge et le vert."
    >
      <div className={styles.balance}>
        <div className={styles.channels}>
          {CHANNELS.map((channel) => (
            <div key={channel.key} className={styles.channel}>
              <span className={styles.channelLabel}>
                <span className={styles.channelDot} style={{ background: channel.color }} />
                {channel.label}
              </span>
              <Slider
                label={`Gain ${channel.label.toLowerCase()}`}
                value={draft[channel.key]}
                onChange={(value) => update({ ...draft, [channel.key]: value })}
                format={(v) => `${Math.round(v)} %`}
              />
            </div>
          ))}
          <div className={styles.presets}>
            {PRESETS.map((preset) => (
              <Button key={preset.label} size="sm" onClick={() => update(preset.value)}>
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
        <div className={styles.whitePreview}>
          <div className={styles.whiteSwatch} style={{ background: preview }} />
          <div className={styles.whiteCaption}>
            Blanc envoyé : <span className="mono">{preview}</span>
            {level < 1 && ` à ${Math.round(level * 100)} %`}
          </div>
        </div>
      </div>
      <div className={styles.testRow}>
        <div>
          <div className={styles.testLabel}>Tester en blanc sur l’appareil</div>
          <div className={styles.testText}>
            Affiche un blanc pur corrigé, à la luminosité générale actuelle, le temps de régler les curseurs.
          </div>
        </div>
        <Switch
          label="Tester en blanc"
          checked={testing}
          onChange={(on) => void run(() => api.setWhiteTest(device.id, on))}
        />
      </div>
    </Section>
  )
}
