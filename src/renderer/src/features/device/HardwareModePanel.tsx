import { HardDriveDownload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { WHITE } from '@shared/color'
import type { AppSnapshot, DeviceInfo, HardwareMode, HardwareModeConfig } from '@shared/model'
import { ColorList } from '@renderer/components/lighting/ColorPicker'
import { Button, SegmentedControl, Select, Slider } from '@renderer/components/ui/controls'
import { Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { deviceLighting } from '@renderer/lib/status'
import { useThrottled } from '@renderer/lib/use-throttled'
import { run } from '@renderer/store/app-store'
import styles from './device.module.css'

const DIRECTIONS = {
  'left-right': [
    { value: '0', label: 'Gauche' },
    { value: '1', label: 'Droite' }
  ],
  'up-down': [
    { value: '2', label: 'Haut' },
    { value: '3', label: 'Bas' }
  ],
  'horizontal-vertical': [
    { value: '4', label: 'Horizontal' },
    { value: '5', label: 'Vertical' }
  ]
} as const

function configFromMode(mode: HardwareMode): HardwareModeConfig {
  return {
    modeName: mode.name,
    speed: mode.speed,
    brightness: mode.brightness,
    direction: mode.capabilities.direction ? mode.direction : null,
    colorMode: mode.colorMode,
    colors: mode.colors.length > 0 ? mode.colors : [WHITE]
  }
}

/** Effects computed by the device itself; they keep running without LightControl once saved. */
export function HardwareModePanel({ snapshot, device }: { snapshot: AppSnapshot; device: DeviceInfo }) {
  const modes = device.modes.filter((mode) => mode.name.toLowerCase() !== 'direct')
  const stored = deviceLighting(snapshot, device.id).hardware
  const [draft, setDraft] = useState<HardwareModeConfig | null>(stored)
  const lastEdit = useRef(0)
  const commit = useThrottled(
    (config: HardwareModeConfig) => void run(() => api.setHardwareMode(device.id, config, false)),
    80
  )

  useEffect(() => {
    if (performance.now() - lastEdit.current > 400) setDraft(stored)
  }, [stored])

  const config = draft ?? (modes[0] ? configFromMode(modes[0]) : null)
  const mode = modes.find((candidate) => candidate.name === config?.modeName)
  if (!config || !mode) return null

  const update = (patch: Partial<HardwareModeConfig>, immediate = false): void => {
    const next = { ...config, ...patch }
    lastEdit.current = performance.now()
    setDraft(next)
    if (immediate) void run(() => api.setHardwareMode(device.id, next, false))
    else commit(next)
  }

  const caps = mode.capabilities
  const colorChoices = [
    caps.modeSpecificColor && { value: 'mode-specific' as const, label: 'Couleurs choisies' },
    caps.randomColor && { value: 'random' as const, label: 'Aléatoire' },
    caps.perLedColor && { value: 'per-led' as const, label: 'Par LED' }
  ].filter((choice) => !!choice)
  const canSave = caps.manualSave || caps.automaticSave

  return (
    <Section
      title="Mode matériel"
      description="L’effet est calculé par l’appareil lui-même : il continue sans LightControl, et peut être conservé au redémarrage."
    >
      <div className={styles.hardware}>
        <div className={styles.hardwareRow}>
          <span className={styles.hardwareLabel}>Mode</span>
          <Select
            aria-label="Mode matériel"
            value={mode.name}
            onChange={(event) => {
              const next = modes.find((candidate) => candidate.name === event.target.value)
              if (next) update(configFromMode(next), true)
            }}
          >
            {modes.map((candidate) => (
              <option key={candidate.index} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </div>

        {caps.speed && (
          <div className={styles.hardwareRow}>
            <span className={styles.hardwareLabel}>Vitesse</span>
            <Slider label="Vitesse" value={config.speed ?? 50} onChange={(speed) => update({ speed })} />
          </div>
        )}
        {caps.brightness && (
          <div className={styles.hardwareRow}>
            <span className={styles.hardwareLabel}>Luminosité</span>
            <Slider
              label="Luminosité"
              value={config.brightness ?? 100}
              onChange={(brightness) => update({ brightness })}
              format={(v) => `${Math.round(v)} %`}
            />
          </div>
        )}
        {caps.directionAxis && (
          <div className={styles.hardwareRow}>
            <span className={styles.hardwareLabel}>Direction</span>
            <div>
              <SegmentedControl
                label="Direction"
                value={String(config.direction ?? DIRECTIONS[caps.directionAxis][0].value)}
                options={[...DIRECTIONS[caps.directionAxis]]}
                onChange={(direction) => update({ direction: Number(direction) }, true)}
              />
            </div>
          </div>
        )}
        {colorChoices.length > 1 && (
          <div className={styles.hardwareRow}>
            <span className={styles.hardwareLabel}>Couleurs</span>
            <div>
              <SegmentedControl
                label="Source des couleurs"
                value={config.colorMode ?? colorChoices[0]!.value}
                options={colorChoices}
                onChange={(colorMode) => update({ colorMode }, true)}
              />
            </div>
          </div>
        )}
        {config.colorMode === 'mode-specific' && mode.colorsMax > 0 && (
          <ColorList
            colors={config.colors.length > 0 ? config.colors : [WHITE]}
            min={Math.max(1, mode.colorsMin)}
            max={Math.max(1, mode.colorsMax)}
            onChange={(colors) => update({ colors })}
          />
        )}
        {/* Modes that read their color from the LEDs (motherboard headers): one color for the whole device. */}
        {config.colorMode === 'per-led' && (
          <ColorList
            colors={[config.colors[0] ?? WHITE]}
            min={1}
            max={1}
            onChange={(colors) => update({ colors })}
          />
        )}

        {canSave && (
          <div className={styles.persist}>
            <div>
              <div className={styles.testLabel}>Conserver dans l’appareil</div>
              <div className={styles.testText}>
                Le mode, la balance des blancs comprise, reste actif au démarrage du PC.
              </div>
            </div>
            <Button
              icon={<HardDriveDownload size={14} />}
              onClick={() =>
                void run(
                  () => api.setHardwareMode(device.id, config, true),
                  'Mode enregistré dans l’appareil'
                )
              }
            >
              Enregistrer
            </Button>
          </div>
        )}
      </div>
    </Section>
  )
}
