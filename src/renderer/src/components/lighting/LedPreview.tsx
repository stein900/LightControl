import { useEffect, useRef } from 'react'
import type { ZoneMatrix } from '@shared/model'
import { frameStore } from '@renderer/store/frame-store'

export interface LedPreviewProps {
  deviceId: string
  startIndex: number
  count: number
  matrix?: ZoneMatrix | null
  height?: number
  className?: string
}

function readCssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#222'
}

/**
 * Canvas preview of the colors currently sent to a range of LEDs. Repaints on
 * frame updates without involving React; dark LEDs use the theme's "off" color.
 */
export function LedPreview({ deviceId, startIndex, count, matrix, height = 14, className }: LedPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let offColor = readCssColor('--led-off')
    let frame = 0
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = (): void => {
      offColor = readCssColor('--led-off')
      schedule()
    }

    const draw = (): void => {
      frame = 0
      const width = canvas.clientWidth
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      if (count <= 0 || width <= 0) return

      const colors = frameStore.get(deviceId)
      const colorAt = (led: number): string => {
        const i = (startIndex + led) * 3
        if (!colors || i + 2 >= colors.length) return offColor
        const r = colors[i]!
        const g = colors[i + 1]!
        const b = colors[i + 2]!
        return r + g + b < 6 ? offColor : `rgb(${r},${g},${b})`
      }

      if (matrix && matrix.width > 0 && matrix.height > 0) {
        const gap = 2
        const cell = Math.min(
          (width - gap * (matrix.width - 1)) / matrix.width,
          (height - gap * (matrix.height - 1)) / matrix.height
        )
        const offsetX = (width - (cell * matrix.width + gap * (matrix.width - 1))) / 2
        for (let y = 0; y < matrix.height; y++) {
          for (let x = 0; x < matrix.width; x++) {
            const led = matrix.cells[y * matrix.width + x]
            if (led === null || led === undefined) continue
            context.fillStyle = colorAt(led)
            context.beginPath()
            context.roundRect(offsetX + x * (cell + gap), y * (cell + gap), cell, cell, Math.min(3, cell / 4))
            context.fill()
          }
        }
        return
      }

      const gap = count > 64 ? 1 : 3
      const slot = (width - gap * (count - 1)) / count
      if (slot >= height * 0.6) {
        const size = Math.min(height, slot)
        const spacing = count > 1 ? Math.min((width - size) / (count - 1), size * 1.9) : 0
        for (let led = 0; led < count; led++) {
          context.fillStyle = colorAt(led)
          context.beginPath()
          context.arc(size / 2 + led * spacing, height / 2, size / 2, 0, Math.PI * 2)
          context.fill()
        }
      } else {
        const bar = Math.max(slot, 0.5)
        for (let led = 0; led < count; led++) {
          context.fillStyle = colorAt(led)
          context.fillRect(led * (bar + gap), 0, Math.max(bar, 0.5), height)
        }
      }
    }

    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(draw)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    const unsubscribe = frameStore.subscribe(schedule)
    scheme.addEventListener('change', onScheme)
    schedule()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
      unsubscribe()
      scheme.removeEventListener('change', onScheme)
    }
  }, [deviceId, startIndex, count, matrix, height])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height, display: 'block' }}
      aria-hidden
    />
  )
}
