import { Focus, LampDesk, Link2, Moon, Pause, Play, Sun } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PC_MODEL_PARTS } from '@shared/schemas'
import type { AppSnapshot, PcModelBackdrop, PcModelPart, ZoneTarget } from '@shared/model'
import { LedPreview } from '@renderer/components/lighting/LedPreview'
import { Button, SegmentedControl, Select, Slider } from '@renderer/components/ui/controls'
import { Section } from '@renderer/components/ui/surfaces'
import { api } from '@renderer/lib/api'
import { deviceName, zoneName } from '@renderer/lib/labels'
import { useThrottled } from '@renderer/lib/use-throttled'
import { run, useAppStore, useSnapshot } from '@renderer/store/app-store'
import { automaticTargets, PART_LABELS, resolveParts, type ResolvedPart } from './parts'
import type { PcScene } from './scene/pc-scene'
import styles from './pc-model.module.css'

const AUTO = 'auto'
const NONE = 'none'
/** Settings echoes of a value still being dragged are ignored for this long. */
const AMBIENT_ECHO_MS = 800

function targetLabel(snapshot: AppSnapshot, target: ZoneTarget | null): string {
  if (!target) return 'éteint'
  const device = snapshot.devices.find((candidate) => candidate.id === target.deviceId)
  if (!device) return 'appareil déconnecté'
  const settings = snapshot.deviceSettings[device.id]
  const zone = device.zones.find((candidate) => candidate.index === target.zoneIndex)
  // Zone first: it is what tells two headers of the same board apart in a narrow select.
  return zone && device.zones.length > 1
    ? `${zoneName(zone, settings)} · ${deviceName(device, settings)}`
    : deviceName(device, settings)
}

function selectValue(resolved: ResolvedPart): string {
  if (resolved.automatic) return AUTO
  return resolved.target ? JSON.stringify(resolved.target) : NONE
}

function BindingRow({
  snapshot,
  resolved,
  automatic,
  onChange,
  onHighlight
}: {
  snapshot: AppSnapshot
  resolved: ResolvedPart
  automatic: ZoneTarget | null
  onChange(value: string): void
  onHighlight(part: PcModelPart | null): void
}) {
  const { part, source, target } = resolved
  const value = selectValue(resolved)
  const missing = !resolved.automatic && target && !snapshot.devices.some((d) => d.id === target.deviceId)
  return (
    <div
      className={styles.binding}
      onPointerEnter={() => onHighlight(part)}
      onPointerLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(part)}
      onBlur={() => onHighlight(null)}
    >
      <span className={styles.bindingLabel}>{PART_LABELS[part]}</span>
      {source ? (
        <LedPreview deviceId={source.deviceId} startIndex={source.start} count={source.count} height={8} />
      ) : (
        <span className={styles.bindingOff}>Éteint</span>
      )}
      <Select aria-label={PART_LABELS[part]} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={AUTO}>Automatique ({targetLabel(snapshot, automatic)})</option>
        <option value={NONE}>Éteint</option>
        {missing && (
          <option value={value} disabled>
            Appareil déconnecté
          </option>
        )}
        {snapshot.devices
          .filter((device) => device.ledCount > 0)
          .map((device) => {
            const settings = snapshot.deviceSettings[device.id]
            const zones = device.zones.length > 1 ? device.zones.filter((zone) => zone.ledCount > 0) : []
            return (
              <optgroup key={device.id} label={deviceName(device, settings)}>
                <option value={JSON.stringify({ deviceId: device.id, zoneIndex: null })}>
                  {zones.length > 0 ? 'Toutes les zones' : deviceName(device, settings)} ({device.ledCount}{' '}
                  LED)
                </option>
                {zones.map((zone) => (
                  <option
                    key={zone.index}
                    value={JSON.stringify({ deviceId: device.id, zoneIndex: zone.index })}
                  >
                    {zoneName(zone, settings)} ({zone.ledCount} LED)
                  </option>
                ))}
              </optgroup>
            )
          })}
      </Select>
    </div>
  )
}

/**
 * Live 3D model of the PC on the overview: each lit part mirrors the colors
 * sent to the device or zone it is bound to.
 */
export function PcModelSection() {
  const snapshot = useSnapshot()
  const navigate = useAppStore((state) => state.navigate)
  const { pcModel } = snapshot.settings
  const parts = useMemo(
    () => resolveParts(snapshot.devices, pcModel.bindings),
    [snapshot.devices, pcModel.bindings]
  )
  const automatic = useMemo(() => automaticTargets(snapshot.devices), [snapshot.devices])

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<PcScene | null>(null)
  const partsRef = useRef(parts)
  partsRef.current = parts
  const pcModelRef = useRef(pcModel)
  pcModelRef.current = pcModel
  const ambientEditedAt = useRef(0)

  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [editing, setEditing] = useState(false)
  const [hovered, setHovered] = useState<PcModelPart | null>(null)
  const [highlight, setHighlight] = useState<PcModelPart | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    let scene: PcScene | null = null
    // three.js is loaded on demand so it never weighs on the rest of the interface.
    void import('./scene/pc-scene')
      .then(({ PcScene }) => {
        if (disposed) return
        scene = new PcScene({
          canvas,
          backdrop: pcModelRef.current.backdrop,
          ambient: pcModelRef.current.ambient,
          onHover: (part, x, y) => {
            setHovered(part)
            const stage = stageRef.current?.getBoundingClientRect()
            if (stage && tooltipRef.current) {
              tooltipRef.current.style.transform = `translate(${x - stage.left + 14}px, ${y - stage.top + 14}px)`
            }
          },
          onSelect: (part) => {
            const source = partsRef.current[part].source
            if (source) navigate({ page: 'device', deviceId: source.deviceId })
            else setEditing(true)
          }
        })
        sceneRef.current = scene
        setStatus('ready')
      })
      .catch(() => {
        if (!disposed) setStatus('failed')
      })
    return () => {
      disposed = true
      scene?.dispose()
      sceneRef.current = null
    }
  }, [navigate])

  useEffect(() => {
    sceneRef.current?.setSources(Object.fromEntries(PC_MODEL_PARTS.map((part) => [part, parts[part].source])))
  }, [parts, status])

  useEffect(() => sceneRef.current?.setMotion(pcModel.motion), [pcModel.motion, status])
  useEffect(() => sceneRef.current?.setHighlight(highlight), [highlight, status])
  useEffect(() => sceneRef.current?.setBackdrop(pcModel.backdrop), [pcModel.backdrop, status])
  useEffect(() => {
    if (performance.now() - ambientEditedAt.current > AMBIENT_ECHO_MS)
      sceneRef.current?.setAmbient(pcModel.ambient)
  }, [pcModel.ambient, status])

  // The scene follows the slider live; the setting is saved at a calmer pace.
  const saveAmbient = useThrottled(
    (ambient: number) => void run(() => api.updateSettings({ pcModel: { ambient } })),
    250
  )
  const changeAmbient = (ambient: number): void => {
    ambientEditedAt.current = performance.now()
    sceneRef.current?.setAmbient(ambient)
    saveAmbient(ambient)
  }

  const bind = (part: PcModelPart, value: string): void => {
    const bindings: Partial<Record<PcModelPart, ZoneTarget | null>> = {}
    for (const other of PC_MODEL_PARTS) {
      if (other !== part && !parts[other].automatic) bindings[other] = parts[other].target
    }
    if (value === NONE) bindings[part] = null
    else if (value !== AUTO) bindings[part] = JSON.parse(value) as ZoneTarget
    void run(() => api.updateSettings({ pcModel: { bindings } }))
  }

  const customised = PC_MODEL_PARTS.some((part) => !parts[part].automatic)
  const hoveredPart = hovered ? parts[hovered] : null

  return (
    <Section
      title="Votre PC"
      description="Aperçu 3D en direct de l’éclairage. Cliquez sur une pièce pour régler l’appareil qui l’alimente."
      flush
      actions={
        <div className={styles.toolbar}>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={pcModel.motion ? 'Figer l’animation' : 'Animer le modèle'}
            icon={pcModel.motion ? <Pause size={14} /> : <Play size={14} />}
            onClick={() => void run(() => api.updateSettings({ pcModel: { motion: !pcModel.motion } }))}
          />
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label="Recentrer la vue"
            icon={<Focus size={14} />}
            onClick={() => sceneRef.current?.resetView()}
          />
          <Button
            size="sm"
            variant={editing ? 'secondary' : 'ghost'}
            icon={<Link2 size={14} />}
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            Associer les zones
          </Button>
        </div>
      }
    >
      <div ref={stageRef} className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} aria-label="Modèle 3D du PC" />
        {status === 'failed' ? (
          <div className={styles.fallback}>L’aperçu 3D demande l’accélération graphique (WebGL).</div>
        ) : (
          <div className={styles.hint}>
            Glisser pour pivoter · Ctrl + molette pour zoomer · Double-clic pour recentrer
          </div>
        )}
        <div ref={tooltipRef} className={styles.tooltip} hidden={!hoveredPart}>
          {hoveredPart && (
            <>
              <div className={styles.tooltipTitle}>{PART_LABELS[hoveredPart.part]}</div>
              <div className={styles.tooltipText}>
                {hoveredPart.source
                  ? targetLabel(snapshot, hoveredPart.target)
                  : 'Non associé : cliquez pour choisir une zone'}
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.sceneBar}>
        <SegmentedControl<PcModelBackdrop>
          label="Décor"
          value={pcModel.backdrop}
          onChange={(backdrop) => void run(() => api.updateSettings({ pcModel: { backdrop } }))}
          options={[
            { value: 'desk', label: 'Bureau', icon: <LampDesk size={14} /> },
            { value: 'dark', label: 'Fond sombre', icon: <Moon size={14} /> }
          ]}
        />
        <div className={styles.ambient}>
          <Sun size={15} aria-hidden />
          <Slider
            label="Luminosité de la scène"
            value={pcModel.ambient}
            onChange={changeAmbient}
            format={(value) => `${Math.round(value)} %`}
          />
        </div>
      </div>

      {editing && (
        <div className={styles.bindings}>
          <p className={styles.bindingsIntro}>
            Indiquez quel header ou appareil alimente chaque pièce. Survolez une ligne pour la repérer sur le
            modèle.
          </p>
          {PC_MODEL_PARTS.map((part) => (
            <BindingRow
              key={part}
              snapshot={snapshot}
              resolved={parts[part]}
              automatic={automatic[part]}
              onChange={(value) => bind(part, value)}
              onHighlight={setHighlight}
            />
          ))}
          {customised && (
            <div className={styles.bindingsFooter}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void run(() => api.updateSettings({ pcModel: { bindings: {} } }))}
              >
                Tout repasser en automatique
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
