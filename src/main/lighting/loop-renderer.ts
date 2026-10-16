/**
 * Pre-renders a software plan as a seamless loop, for devices that receive an
 * animation once and play it on their own (wireless). The loop covers the
 * longest effect period of the device; still effects become a single frame.
 * The backend may decimate frames further to fit the device memory.
 */
import type { LedLoop } from '@main/hardware/backend'
import { quantize } from './color-pipeline'
import type { SoftwarePlan } from './planner'

const TARGET_FRAME_MS = 50
/** Slower effects (a full spectrum turn at minimum speed lasts 60 s) are cut at this length. */
const MAX_LOOP_SECONDS = 120
const MAX_FRAMES = 1024
const STILL_INTERVAL_MS = 1000

export function renderLoop(plan: SoftwarePlan): LedLoop {
  const float = new Float32Array(plan.ledCount * 3)
  const renderAt = (time: number): Uint8Array => {
    for (const zone of plan.zones) {
      zone.render(
        { time, count: zone.ledCount, seed: zone.seed, layout: zone.layout },
        float,
        zone.startIndex
      )
    }
    const frame = new Uint8Array(plan.ledCount * 3)
    quantize(float, frame, plan.gains)
    return frame
  }

  const periods = plan.zones.flatMap((zone) => (zone.animated && zone.period ? [zone.period] : []))
  if (periods.length === 0) return { frames: [renderAt(0)], intervalMs: STILL_INTERVAL_MS }

  const period = Math.min(MAX_LOOP_SECONDS, Math.max(...periods))
  const count = Math.min(MAX_FRAMES, Math.max(2, Math.round((period * 1000) / TARGET_FRAME_MS)))
  const intervalMs = (period * 1000) / count
  return { frames: Array.from({ length: count }, (_, i) => renderAt((i * intervalMs) / 1000)), intervalMs }
}

/** Frame of a loop shown at `elapsedMs` after it started, for the live preview. */
export function loopFrameAt(loop: LedLoop, elapsedMs: number): Uint8Array {
  const index = Math.floor(elapsedMs / loop.intervalMs) % loop.frames.length
  return loop.frames[index]!
}
