/**
 * Executes device plans against the hardware backend: switches devices between
 * direct and hardware modes, renders software frames on a shared clock and
 * only transmits frames whose bytes changed. Static frames are re-sent at a low
 * rate so vendor software that briefly takes over the lights is corrected.
 * Devices that play animations on their own (`loop` delivery) receive one
 * pre-rendered loop per change instead of a stream.
 */
import type { Logger } from '@main/core/logger'
import type { HardwareBackend, LedLoop } from '@main/hardware/backend'
import type { Rgb } from '@shared/color'
import type { DeviceFrame } from '@shared/model'
import { quantize } from './color-pipeline'
import { loopFrameAt, renderLoop } from './loop-renderer'
import type { DevicePlan, HardwarePlan, SoftwarePlan } from './planner'

const STATIC_REFRESH_MS = 2000

function solidFrame(ledCount: number, color: Rgb | null): Uint8Array {
  const frame = new Uint8Array(ledCount * 3)
  if (color) for (let i = 0; i < ledCount; i++) frame.set([color.r, color.g, color.b], i * 3)
  return frame
}

interface SoftwareState {
  plan: SoftwarePlan
  float: Float32Array
  bytes: Uint8Array
  animated: boolean
  needsSend: boolean
  lastSentAt: number
}

interface HardwareState {
  plan: HardwarePlan
  preview: Uint8Array
}

interface LoopState {
  plan: SoftwarePlan
  loop: LedLoop
  startedAt: number
  /** The backend could not take the loop yet; retried on the refresh cadence. */
  pending: boolean
}

type DeviceState =
  | { kind: 'software'; state: SoftwareState }
  | { kind: 'hardware'; state: HardwareState }
  | { kind: 'loop'; state: LoopState }

export class LightingEngine {
  private readonly states = new Map<string, DeviceState>()
  private timer: NodeJS.Timeout | null = null
  private interval = 0
  private readonly epoch = performance.now()

  constructor(
    private readonly backend: HardwareBackend,
    private readonly frameRate: () => number,
    private readonly logger: Logger
  ) {}

  /** Replaces all plans. Devices missing from `plans` are released (left as they are). */
  apply(plans: Map<string, DevicePlan>): void {
    for (const deviceId of [...this.states.keys()]) {
      if (!plans.has(deviceId)) this.states.delete(deviceId)
    }
    for (const [deviceId, plan] of plans) {
      if (plan.kind === 'hardware') this.applyHardware(deviceId, plan)
      else if (this.deliveryOf(deviceId) === 'loop') this.applyLoop(deviceId, plan)
      else this.applySoftware(deviceId, plan)
    }
    this.renderFrame(true)
    this.updateTimer()
  }

  /** Forgets what was sent, so the next frame re-initialises every device (after a reconnect). */
  reset(): void {
    this.states.clear()
  }

  /** Re-sends the current hardware mode with the persist flag (store in device memory). */
  persistHardwareMode(deviceId: string): boolean {
    const entry = this.states.get(deviceId)
    if (entry?.kind !== 'hardware') return false
    const { plan } = entry.state
    return this.backend.applyMode(deviceId, plan.modeName, plan.overrides, true)
  }

  frames(): DeviceFrame[] {
    const frames: DeviceFrame[] = []
    const now = performance.now()
    for (const [deviceId, entry] of this.states) {
      const colors =
        entry.kind === 'software'
          ? entry.state.bytes
          : entry.kind === 'loop'
            ? loopFrameAt(entry.state.loop, now - entry.state.startedAt)
            : entry.state.preview
      frames.push({ deviceId, colors: colors.slice() })
    }
    return frames
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.states.clear()
  }

  /* -------------------------------- Plans --------------------------------- */

  private applySoftware(deviceId: string, plan: SoftwarePlan): void {
    const previous = this.states.get(deviceId)
    const reusable = previous?.kind === 'software' && previous.state.bytes.length === plan.ledCount * 3
    if (!previous || previous.kind !== 'software') {
      this.logger.debug(`Direct mode for ${deviceId}`)
      this.backend.enterDirectMode(deviceId)
    }
    const animated = plan.zones.some((zone) => zone.animated)
    if (reusable && previous.state.plan.signature === plan.signature) {
      previous.state.plan = plan
      previous.state.animated = animated
      return
    }
    this.states.set(deviceId, {
      kind: 'software',
      state: {
        plan,
        float: new Float32Array(plan.ledCount * 3),
        bytes: reusable ? previous.state.bytes : new Uint8Array(plan.ledCount * 3),
        animated,
        needsSend: true,
        lastSentAt: 0
      }
    })
  }

  private applyLoop(deviceId: string, plan: SoftwarePlan): void {
    const previous = this.states.get(deviceId)
    if (previous?.kind === 'loop' && previous.state.plan.signature === plan.signature) {
      previous.state.plan = plan
      return
    }
    const loop = renderLoop(plan)
    const queued = this.backend.writeLoop(deviceId, loop)
    this.logger.debug(`Loop of ${loop.frames.length} frame(s) for ${deviceId}${queued ? '' : ', retrying'}`)
    this.states.set(deviceId, {
      kind: 'loop',
      state: { plan, loop, startedAt: performance.now(), pending: !queued }
    })
  }

  private deliveryOf(deviceId: string): 'live' | 'loop' {
    return this.backend.devices.find((device) => device.id === deviceId)?.delivery ?? 'live'
  }

  private applyHardware(deviceId: string, plan: HardwarePlan): void {
    const previous = this.states.get(deviceId)
    if (previous?.kind === 'hardware' && previous.state.plan.signature === plan.signature) return

    const ledCount = this.backend.devices.find((device) => device.id === deviceId)?.ledCount ?? 0
    this.logger.debug(`Hardware mode "${plan.modeName}" for ${deviceId}`)
    if (!this.backend.applyMode(deviceId, plan.modeName, plan.overrides, false)) return
    // On devices such as MSI boards the mode reads its colors from the LEDs: write them after the mode.
    if (plan.ledFill) this.backend.writeLeds(deviceId, solidFrame(ledCount, plan.ledFill))
    this.states.set(deviceId, {
      kind: 'hardware',
      state: { plan, preview: solidFrame(ledCount, plan.preview) }
    })
  }

  /* -------------------------------- Frames -------------------------------- */

  private updateTimer(): void {
    const animated = [...this.states.values()].some(
      (entry) => entry.kind === 'software' && entry.state.animated
    )
    const hasSoftware = [...this.states.values()].some(
      (entry) => entry.kind === 'software' || (entry.kind === 'loop' && entry.state.pending)
    )
    // Animated content runs at the configured rate; static content only needs the refresh cadence.
    const interval = animated ? Math.round(1000 / this.frameRate()) : hasSoftware ? STATIC_REFRESH_MS : 0

    if (interval === this.interval) return
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.interval = interval
    if (interval > 0) this.timer = setInterval(() => this.renderFrame(false), interval)
  }

  private renderFrame(force: boolean): void {
    const now = performance.now()
    const time = (now - this.epoch) / 1000
    for (const [deviceId, entry] of this.states) {
      // A loop refused by the backend (device not ready) is offered again on the refresh cadence.
      if (entry.kind === 'loop' && entry.state.pending && !force) {
        entry.state.pending = !this.backend.writeLoop(deviceId, entry.state.loop)
        if (!entry.state.pending) entry.state.startedAt = now
      }
      if (entry.kind !== 'software') continue
      const state = entry.state
      if (!state.animated && !state.needsSend && !force && now - state.lastSentAt < STATIC_REFRESH_MS)
        continue

      for (const zone of state.plan.zones) {
        zone.render(
          { time, count: zone.ledCount, seed: zone.seed, layout: zone.layout },
          state.float,
          zone.startIndex
        )
      }
      const changed = quantize(state.float, state.bytes, state.plan.gains)
      const due = state.needsSend || changed || now - state.lastSentAt >= STATIC_REFRESH_MS
      if (due && this.backend.writeLeds(deviceId, state.bytes)) {
        state.needsSend = false
        state.lastSentAt = now
      }
    }
  }
}
