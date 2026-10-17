/**
 * Procedural canvas textures for the PC model: printed circuit board, finned
 * and plated heatsinks, honeycomb mesh, labels and the glass reflections.
 * Everything is drawn at startup, so the model needs no image assets.
 */
import * as THREE from 'three'

type Draw = (context: CanvasRenderingContext2D, width: number, height: number) => void

interface TextureOptions {
  /** Color textures are sRGB; masks and alpha maps stay linear. */
  color?: boolean
  repeat?: [number, number]
}

function canvasTexture(
  width: number,
  height: number,
  draw: Draw,
  options: TextureOptions = {}
): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) draw(context, width, height)
  const texture = new THREE.CanvasTexture(canvas)
  if (options.color ?? true) texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (options.repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(...options.repeat)
  }
  return texture
}

/** Deterministic pseudo-random sequence: the board looks the same on every launch. */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FONT = '"Geist Variable", "Segoe UI", sans-serif'

export function pcbTexture(): THREE.Texture {
  return canvasTexture(512, 640, (c, w, h) => {
    c.fillStyle = '#131418'
    c.fillRect(0, 0, w, h)
    const next = random(7)

    // Copper traces running at right angles and diagonals.
    c.lineCap = 'round'
    for (let i = 0; i < 260; i++) {
      c.strokeStyle = `rgba(${60 + next() * 30}, ${64 + next() * 30}, ${76 + next() * 30}, ${0.25 + next() * 0.3})`
      c.lineWidth = 0.8 + next() * 1.4
      let x = next() * w
      let y = next() * h
      c.beginPath()
      c.moveTo(x, y)
      for (let s = 0; s < 3; s++) {
        const length = 10 + next() * 60
        const angle = Math.floor(next() * 8) * (Math.PI / 4)
        x += Math.cos(angle) * length
        y += Math.sin(angle) * length
        c.lineTo(x, y)
      }
      c.stroke()
    }

    // Grey graphic stripes printed on the board, as on MSI boards.
    c.strokeStyle = 'rgba(150, 156, 168, 0.22)'
    c.lineWidth = 5
    for (let i = 0; i < 6; i++) {
      c.beginPath()
      c.moveTo(20 + i * 18, h - 30)
      c.lineTo(150 + i * 18, h - 200)
      c.lineTo(150 + i * 18, h - 330)
      c.stroke()
    }

    // Mounting holes.
    c.fillStyle = '#8d9098'
    for (const [x, y] of [
      [20, 20],
      [w - 30, 20],
      [20, h / 2],
      [w - 30, h / 2],
      [20, h - 20],
      [w - 30, h - 20]
    ] as const) {
      c.beginPath()
      c.arc(x, y, 9, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#0b0b0d'
      c.beginPath()
      c.arc(x, y, 4.5, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = '#8d9098'
    }

    // Silkscreen.
    c.fillStyle = 'rgba(205, 208, 214, 0.6)'
    c.font = `600 15px ${FONT}`
    c.fillText('X670E GAMING PLUS WIFI', 300, h - 36)
    c.font = `500 10px ${FONT}`
    for (let i = 0; i < 26; i++) c.fillText(`C${100 + Math.floor(next() * 800)}`, next() * w, next() * h)
  })
}

/** Machined fins: alternating bright ridges and dark grooves. */
export function finsTexture(repeat: [number, number], vertical = false): THREE.Texture {
  return canvasTexture(
    128,
    128,
    (c, w, h) => {
      const gradient = vertical ? c.createLinearGradient(0, 0, 0, h) : c.createLinearGradient(0, 0, w, 0)
      gradient.addColorStop(0, '#c7cad1')
      gradient.addColorStop(1, '#aeb2ba')
      c.fillStyle = gradient
      c.fillRect(0, 0, w, h)
      for (let i = 0; i < 8; i++) {
        const at = i * 16
        c.fillStyle = 'rgba(28, 30, 36, 0.7)'
        if (vertical) c.fillRect(at, 0, 5, h)
        else c.fillRect(0, at, w, 5)
        c.fillStyle = 'rgba(255, 255, 255, 0.45)'
        if (vertical) c.fillRect(at + 6, 0, 1.5, h)
        else c.fillRect(0, at + 6, w, 1.5)
      }
    },
    { repeat }
  )
}

/** Brushed aluminium cover with dark angular line art, like MSI's I/O and chipset shrouds. */
export function plateTexture(seed: number, label = ''): THREE.Texture {
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#c5c8cf'
    c.fillRect(0, 0, w, h)
    const next = random(seed)
    for (let y = 0; y < h; y += 2) {
      c.fillStyle = `rgba(255, 255, 255, ${next() * 0.12})`
      c.fillRect(0, y, w, 1)
    }
    c.strokeStyle = '#2b2d33'
    c.lineJoin = 'miter'
    for (let i = 0; i < 5; i++) {
      c.lineWidth = 6 + next() * 10
      c.beginPath()
      const x = next() * w
      c.moveTo(x, -10)
      c.lineTo(x + (next() - 0.5) * 220, h * (0.3 + next() * 0.3))
      c.lineTo(x + (next() - 0.5) * 320, h + 10)
      c.stroke()
    }
    c.fillStyle = '#26282d'
    c.beginPath()
    c.moveTo(w * 0.15, h * 0.85)
    c.lineTo(w * 0.5, h * 0.55)
    c.lineTo(w * 0.85, h * 0.85)
    c.lineTo(w * 0.5, h * 0.72)
    c.closePath()
    c.fill()
    if (label) {
      c.fillStyle = '#25272c'
      c.font = `italic 800 92px ${FONT}`
      c.textAlign = 'center'
      c.fillText(label, w / 2, h * 0.4)
    }
  })
}

/** Black honeycomb grille of the top, bottom and rear panels. */
export function honeycombTexture(repeat: [number, number]): THREE.Texture {
  return canvasTexture(
    96,
    166,
    (c, w, h) => {
      c.fillStyle = '#16171b'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#040405'
      const radius = 24
      const hexagon = (x: number, y: number): void => {
        c.beginPath()
        for (let k = 0; k < 6; k++) {
          const angle = Math.PI / 6 + (k * Math.PI) / 3
          c.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
        }
        c.closePath()
        c.fill()
      }
      for (const [x, y] of [
        [0, 0],
        [w, 0],
        [w / 2, h / 2],
        [0, h],
        [w, h]
      ] as const) {
        hexagon(x, y)
      }
    },
    { repeat }
  )
}

/** Slotted PCI covers on the rear panel. */
export function slotsTexture(): THREE.Texture {
  return canvasTexture(256, 512, (c, w, h) => {
    c.fillStyle = '#0d0d10'
    c.fillRect(0, 0, w, h)
    const slots = 7
    for (let i = 0; i < slots; i++) {
      const y = (i + 0.5) * (h / slots)
      c.fillStyle = '#1b1c21'
      c.fillRect(10, y - 26, w - 20, 52)
      c.fillStyle = '#050506'
      for (let k = 0; k < 9; k++) c.fillRect(28 + k * 23, y - 14, 10, 28)
    }
  })
}

/** Text on a transparent background, used as a decal. */
export function labelTexture(
  text: string,
  width: number,
  height: number,
  font: string,
  color: string
): THREE.Texture {
  return canvasTexture(width, height, (c) => {
    c.font = `${font} ${FONT}`
    c.fillStyle = color
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(text, width / 2, height / 2)
  })
}

/** Three curved sails: the emblem on the pump cap, white on transparent. */
export function sailsTexture(): THREE.Texture {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = '#ffffff'
    for (let i = 0; i < 3; i++) {
      const y = 92 + i * 34
      c.beginPath()
      c.moveTo(70, y + 26)
      c.quadraticCurveTo(110 - i * 6, y - 30, 196 - i * 18, y - 20)
      c.quadraticCurveTo(142 - i * 8, y - 2, 96, y + 30)
      c.closePath()
      c.fill()
    }
  })
}

/** Glass-facing edge of the graphics card: silver accents and the GEFORCE RTX lettering. */
export function gpuSideTexture(): THREE.Texture {
  return canvasTexture(1024, 224, (c, w, h) => {
    c.fillStyle = '#1b1c20'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#26272c'
    c.beginPath()
    c.moveTo(0, h * 0.62)
    c.lineTo(w * 0.32, h * 0.62)
    c.lineTo(w * 0.38, h * 0.18)
    c.lineTo(w, h * 0.18)
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.closePath()
    c.fill()
    c.strokeStyle = '#a9adb6'
    c.lineWidth = 4
    c.beginPath()
    c.moveTo(0, h * 0.6)
    c.lineTo(w * 0.315, h * 0.6)
    c.lineTo(w * 0.375, h * 0.16)
    c.lineTo(w * 0.97, h * 0.16)
    c.stroke()
    c.fillStyle = '#b4b7bf'
    c.font = `600 54px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('GEFORCE RTX', w * 0.66, h * 0.58)
  })
}

/** Backplate seen from above: brushed metal, flow-through cut-out and the brand. */
export function backplateTexture(): THREE.Texture {
  return canvasTexture(1024, 420, (c, w, h) => {
    c.fillStyle = '#25262b'
    c.fillRect(0, 0, w, h)
    const next = random(11)
    for (let y = 0; y < h; y += 2) {
      c.fillStyle = `rgba(255, 255, 255, ${next() * 0.05})`
      c.fillRect(0, y, w, 1)
    }
    // Flow-through window at the far end, fins visible through it.
    c.fillStyle = '#0a0a0c'
    c.fillRect(w * 0.76, h * 0.12, w * 0.2, h * 0.76)
    c.fillStyle = '#34363c'
    for (let x = w * 0.765; x < w * 0.955; x += 12) c.fillRect(x, h * 0.12, 4, h * 0.76)
    c.fillStyle = '#9da0a8'
    c.font = `700 46px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('GIGABYTE', w * 0.38, h * 0.5)
  })
}

/** Soft diagonal highlights drawn additively over the glass panels. */
export function glassStreakTexture(): THREE.Texture {
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#000000'
    c.fillRect(0, 0, w, h)
    const band = (offset: number, width: number, strength: number): void => {
      const gradient = c.createLinearGradient(offset, 0, offset + width, h * 0.35)
      gradient.addColorStop(0, 'rgba(255,255,255,0)')
      gradient.addColorStop(0.5, `rgba(255,255,255,${strength})`)
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = gradient
      c.beginPath()
      c.moveTo(offset, 0)
      c.lineTo(offset + width, 0)
      c.lineTo(offset + width - w * 0.55, h)
      c.lineTo(offset - w * 0.55, h)
      c.closePath()
      c.fill()
    }
    band(w * 0.55, w * 0.22, 0.55)
    band(w * 0.86, w * 0.08, 0.35)
    const top = c.createLinearGradient(0, 0, 0, h * 0.18)
    top.addColorStop(0, 'rgba(255,255,255,0.18)')
    top.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = top
    c.fillRect(0, 0, w, h * 0.18)
  })
}

export function radialTexture(): THREE.Texture {
  return canvasTexture(
    256,
    256,
    (c) => {
      const gradient = c.createRadialGradient(128, 128, 0, 128, 128, 128)
      gradient.addColorStop(0, '#ffffff')
      gradient.addColorStop(0.35, '#9a9a9a')
      gradient.addColorStop(1, '#000000')
      c.fillStyle = gradient
      c.fillRect(0, 0, 256, 256)
    },
    { color: false }
  )
}

/* ------------------------------ Desk diorama ------------------------------ */

/** Light oak with long, slightly wavy grain. */
export function woodTexture(): THREE.Texture {
  return canvasTexture(1024, 512, (c, w, h) => {
    c.fillStyle = '#c9a072'
    c.fillRect(0, 0, w, h)
    const next = random(21)
    for (let i = 0; i < 140; i++) {
      const y = next() * h
      const amplitude = 2 + next() * 6
      const phase = next() * Math.PI * 2
      c.strokeStyle =
        next() > 0.5
          ? `rgba(120, 78, 40, ${0.08 + next() * 0.16})`
          : `rgba(235, 200, 155, ${0.1 + next() * 0.15})`
      c.lineWidth = 0.6 + next() * 2.2
      c.beginPath()
      for (let x = 0; x <= w; x += 16) {
        const dy = Math.sin(x / 140 + phase) * amplitude
        if (x === 0) c.moveTo(x, y + dy)
        else c.lineTo(x, y + dy)
      }
      c.stroke()
    }
  })
}

/** Oak floor planks with staggered joints. */
export function floorTexture(repeat: [number, number]): THREE.Texture {
  return canvasTexture(
    512,
    512,
    (c, w, h) => {
      const next = random(33)
      const rows = 6
      const plank = h / rows
      for (let row = 0; row < rows; row++) {
        let x = -next() * 300
        while (x < w) {
          const length = 220 + next() * 260
          const tone = 150 + next() * 40
          c.fillStyle = `rgb(${tone}, ${tone * 0.72}, ${tone * 0.48})`
          c.fillRect(x, row * plank, length, plank)
          for (let k = 0; k < 6; k++) {
            c.strokeStyle = `rgba(90, 55, 25, ${0.08 + next() * 0.12})`
            c.lineWidth = 1
            const y = row * plank + next() * plank
            c.beginPath()
            c.moveTo(x, y)
            c.lineTo(x + length, y + (next() - 0.5) * 6)
            c.stroke()
          }
          c.fillStyle = 'rgba(40, 25, 12, 0.55)'
          c.fillRect(x, row * plank, 2, plank)
          x += length
        }
        c.fillStyle = 'rgba(40, 25, 12, 0.6)'
        c.fillRect(0, row * plank, w, 2)
      }
    },
    { repeat }
  )
}

/** Desktop wallpaper: dusk gradient over layered hills. */
export function wallpaperTexture(): THREE.Texture {
  return canvasTexture(1024, 576, (c, w, h) => {
    const sky = c.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#1d1b4a')
    sky.addColorStop(0.55, '#6b3f8f')
    sky.addColorStop(1, '#f19a7a')
    c.fillStyle = sky
    c.fillRect(0, 0, w, h)
    c.fillStyle = 'rgba(255, 214, 170, 0.9)'
    c.beginPath()
    c.arc(w * 0.68, h * 0.62, 70, 0, Math.PI * 2)
    c.fill()
    const hills: [string, number, number][] = [
      ['#4a2c6e', 0.66, 60],
      ['#30214f', 0.76, 45],
      ['#1b1433', 0.87, 35]
    ]
    for (const [color, base, amplitude] of hills) {
      c.fillStyle = color
      c.beginPath()
      c.moveTo(0, h)
      for (let x = 0; x <= w; x += 8) c.lineTo(x, h * base + Math.sin(x / 120 + base * 10) * amplitude)
      c.lineTo(w, h)
      c.closePath()
      c.fill()
    }
    // Taskbar.
    c.fillStyle = 'rgba(12, 12, 20, 0.8)'
    c.fillRect(0, h - 30, w, 30)
    c.fillStyle = 'rgba(255, 255, 255, 0.75)'
    for (let i = 0; i < 6; i++) c.fillRect(w / 2 - 75 + i * 26, h - 22, 16, 14)
  })
}

/** Keycaps seen from above. */
export function keyboardTexture(): THREE.Texture {
  return canvasTexture(1024, 320, (c, w, h) => {
    c.fillStyle = '#121215'
    c.fillRect(0, 0, w, h)
    const rows = [15, 15, 14, 13, 12]
    const unit = w / 17.5
    rows.forEach((count, row) => {
      let x = unit * 0.25
      for (let k = 0; k < count; k++) {
        const wide = (row === 4 && k === 4) || (k === count - 1 && row < 4)
        const width = unit * (row === 4 && k === 4 ? 6 : wide ? 1.6 : 1) - 6
        c.fillStyle = '#26272c'
        c.beginPath()
        c.roundRect(x, 12 + row * (h / 5.2), width, h / 5.2 - 10, 6)
        c.fill()
        c.fillStyle = 'rgba(255, 255, 255, 0.05)'
        c.fillRect(x + 4, 16 + row * (h / 5.2), width - 8, 6)
        x += width + 6
      }
    })
  })
}

/** Framed print: a pastel sunset. */
export function posterTexture(): THREE.Texture {
  return canvasTexture(560, 400, (c, w, h) => {
    c.fillStyle = '#f3ebe0'
    c.fillRect(0, 0, w, h)
    const inner = { x: 40, y: 40, w: w - 80, h: h - 80 }
    const sky = c.createLinearGradient(0, inner.y, 0, inner.y + inner.h)
    sky.addColorStop(0, '#f7c9a9')
    sky.addColorStop(1, '#e98f6f')
    c.fillStyle = sky
    c.fillRect(inner.x, inner.y, inner.w, inner.h)
    c.fillStyle = '#fbe6c8'
    c.beginPath()
    c.arc(w / 2, inner.y + inner.h * 0.62, 56, 0, Math.PI * 2)
    c.fill()
    for (const [color, base] of [
      ['#c46a5a', 0.7],
      ['#8f4a52', 0.82],
      ['#5b3445', 0.92]
    ] as const) {
      c.fillStyle = color
      c.beginPath()
      c.moveTo(inner.x, inner.y + inner.h)
      for (let x = 0; x <= inner.w; x += 6) {
        c.lineTo(inner.x + x, inner.y + inner.h * base + Math.sin(x / 50 + base * 8) * 14)
      }
      c.lineTo(inner.x + inner.w, inner.y + inner.h)
      c.closePath()
      c.fill()
    }
  })
}

/** Night falling over the city, seen through the window: dusk band, stars, crescent moon, lit windows. */
export function nightSkyTexture(): THREE.Texture {
  return canvasTexture(512, 576, (c, w, h) => {
    const sky = c.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, '#070b1c')
    sky.addColorStop(0.45, '#14214a')
    sky.addColorStop(0.72, '#3b3e72')
    sky.addColorStop(0.86, '#a3667a')
    sky.addColorStop(1, '#e09468')
    c.fillStyle = sky
    c.fillRect(0, 0, w, h)

    const next = random(77)
    for (let i = 0; i < 90; i++) {
      c.fillStyle = `rgba(255, 255, 255, ${0.25 + next() * 0.6})`
      const size = next() < 0.12 ? 2.2 : 1.2
      c.fillRect(next() * w, next() * h * 0.55, size, size)
    }

    // Crescent: a full disc, bitten by a disc of sky.
    c.fillStyle = '#f4ead0'
    c.beginPath()
    c.arc(w * 0.7, h * 0.2, 26, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#0c1430'
    c.beginPath()
    c.arc(w * 0.7 + 11, h * 0.2 - 7, 24, 0, Math.PI * 2)
    c.fill()

    // Skyline in two depths, with warm and cool lit windows.
    const skyline = (base: number, color: string, lit: number): void => {
      let x = -10
      while (x < w) {
        const width = 26 + next() * 46
        const height = 40 + next() * 150
        const top = h * base - height
        c.fillStyle = color
        c.fillRect(x, top, width, h - top)
        for (let wy = top + 8; wy < h - 6; wy += 11) {
          for (let wx = x + 5; wx < x + width - 6; wx += 9) {
            if (next() > lit) continue
            c.fillStyle = next() > 0.25 ? 'rgba(255, 206, 128, 0.95)' : 'rgba(190, 215, 255, 0.85)'
            c.fillRect(wx, wy, 4, 5)
          }
        }
        x += width + 2 + next() * 6
      }
    }
    skyline(0.86, '#141a33', 0.18)
    skyline(0.97, '#0a0d1c', 0.3)
  })
}

/** Low-pile wool rug: warm grey, fine weave and a quiet border. */
export function rugTexture(): THREE.Texture {
  return canvasTexture(512, 384, (c, w, h) => {
    c.fillStyle = '#7b736b'
    c.fillRect(0, 0, w, h)
    const next = random(5)
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = next() > 0.5 ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)'
      c.fillRect(next() * w, next() * h, 2 + next() * 5, 1)
    }
    c.strokeStyle = 'rgba(214, 204, 188, 0.55)'
    c.lineWidth = 5
    c.strokeRect(22, 22, w - 44, h - 44)
    c.lineWidth = 1.5
    c.strokeRect(34, 34, w - 68, h - 68)
  })
}

/** Backdrop behind the diorama: dim at the top, warmer towards the bottom. */
export function backdropTexture(): THREE.Texture {
  return canvasTexture(16, 512, (c, w, h) => {
    const gradient = c.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, '#15151b')
    gradient.addColorStop(1, '#262222')
    c.fillStyle = gradient
    c.fillRect(0, 0, w, h)
  })
}
