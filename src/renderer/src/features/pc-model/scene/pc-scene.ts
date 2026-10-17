/**
 * Renders the PC model with the live LED colors. Device frames come from the
 * frame store (20 per second) and are eased towards on every animation frame,
 * so the model stays fluid at the display rate. The loop only runs while the
 * canvas is on screen and the window visible.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { PcModelBackdrop, PcModelPart } from '@shared/model'
import { frameStore } from '@renderer/store/frame-store'
import type { PartSource } from '../parts'
import { buildPcModel, type LedStrip, type PcModel } from './build-pc'
import { buildRoom, type Room } from './build-room'
import { backdropTexture } from './textures'

export interface PcSceneOptions {
  canvas: HTMLCanvasElement
  /** Starting backdrop and room lighting (0–100); later changes go through the setters. */
  backdrop: PcModelBackdrop
  ambient: number
  /** Pointer over a part (or nothing), in client coordinates. */
  onHover(part: PcModelPart | null, x: number, y: number): void
  onSelect(part: PcModelPart): void
}

const BACKGROUND = 0x09090c
/** Unlit LEDs keep the grey of their diffuser. */
const LED_OFF = 0.03
/** LEDs are brighter than anything lit around them; the excess feeds the bloom. */
const LED_GAIN = 2.6
/** Point lights per fan, pump, stick…, and the fill light that tints the whole case. */
const LIGHT_GAIN = 0.013
const FILL_GAIN = 0.014
/**
 * Exponent applied to an LED's level (its brightest channel). The eye reads a
 * real LED at 50 % PWM as fairly bright; a linear rendering would show it
 * nearly dark, so levels are lifted along this curve, hue untouched.
 */
const LEVEL_CURVE = 0.5
const SMOOTHING_S = 0.06
/**
 * Minimum time between two rendered frames: every frame at 60 Hz, every other
 * one at 120–144 Hz, so high refresh rate displays do not double the GPU load.
 */
const MIN_FRAME_MS = 12
const FAN_TURNS_PER_S = 0.45
const DIMMED = 0.15

/**
 * Default camera per backdrop: the dark stage frames the PC, the diorama is
 * seen as a whole, from higher up, orbiting around the desk (metres).
 */
const VIEWS: Record<
  PcModelBackdrop,
  {
    distance: number
    polar: number
    azimuth: number
    maxDistance: number
    target: readonly [number, number, number] | null
  }
> = {
  desk: { distance: 3.3, polar: 1.12, azimuth: 0.45, maxDistance: 4.8, target: [-0.3, 0.05, 0.06] },
  dark: { distance: 1.22, polar: 1.47, azimuth: 0.5, maxDistance: 2.4, target: null }
}
/** Idle camera sways between these azimuths (radians, 0 faces the side glass). */
const SWAY_MIN = -0.25
const SWAY_MAX = 0.95
const SWAY_SPEED = 0.55
const IDLE_BEFORE_SWAY_MS = 4000

const MIX_VERTEX = `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const MIX_FRAGMENT = `uniform sampler2D baseTexture;
uniform sampler2D bloomTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
}`

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
const LEVEL = Float32Array.from({ length: 256 }, (_, i) => (i / 255) ** LEVEL_CURVE)

/** Linear emission of an 8-bit LED color: the hue at full scale, times its lifted level. */
function emission(frame: Uint8Array, i: number, out: Float32Array): void {
  const r = frame[i] ?? 0
  const g = frame[i + 1] ?? 0
  const b = frame[i + 2] ?? 0
  const peak = Math.max(r, g, b)
  if (peak === 0) {
    out[0] = out[1] = out[2] = 0
    return
  }
  const scale = 255 / peak
  const level = LEVEL[peak]!
  out[0] = SRGB_TO_LINEAR[Math.round(r * scale)]! * level
  out[1] = SRGB_TO_LINEAR[Math.round(g * scale)]! * level
  out[2] = SRGB_TO_LINEAR[Math.round(b * scale)]! * level
}

interface DeviceColors {
  /** Linear colors eased towards the latest frame: what the LEDs emit. */
  eased: Float32Array
  /**
   * Same colors evened out by `perceivedBoost`: what the LEDs, glowing plastics
   * and lights show, so a blue setup lights the case as much as a white one.
   */
  glow: Float32Array
}

/**
 * Saturated blues and reds carry little luminance, so the bloom would skip
 * them while white glows. Scaling by the inverse root of the hue's relative
 * luminance makes every full-brightness LED glow alike, as it does to the eye.
 */
function perceivedBoost(r: number, g: number, b: number): number {
  const peak = Math.max(r, g, b)
  if (peak < 1e-5) return 1
  return 1 / Math.sqrt(Math.max(0.16, (0.2126 * r + 0.7152 * g + 0.0722 * b) / peak))
}

interface Sampler {
  count: number
  /** Per vertex: the two LEDs (relative to the source) it blends, and the blend factor. */
  a: Int32Array
  b: Int32Array
  f: Float32Array
}

/** LEDs whose centre falls inside [from, to) of a chain of `count` LEDs; never empty. */
function ledRange(from: number, to: number, count: number): [number, number] {
  const lo = Math.max(0, Math.ceil(from * count - 0.5))
  const hi = Math.min(count - 1, Math.ceil(to * count - 0.5) - 1)
  if (hi >= lo) return [lo, hi]
  const nearest = Math.min(count - 1, Math.floor(((from + to) / 2) * count))
  return [nearest, nearest]
}

function buildSampler(strip: LedStrip, count: number): Sampler {
  const vertices = strip.chain.length
  const sampler = {
    count,
    a: new Int32Array(vertices),
    b: new Int32Array(vertices),
    f: new Float32Array(vertices)
  }
  const [lo, hi] = ledRange(strip.from, strip.to, count)
  const span = hi - lo + 1
  const fit = (led: number): number =>
    strip.closed ? lo + ((((led - lo) % span) + span) % span) : Math.min(hi, Math.max(lo, led))
  for (let v = 0; v < vertices; v++) {
    const position = strip.chain[v]! * count - 0.5
    const a = Math.floor(position)
    sampler.a[v] = fit(a)
    sampler.b[v] = fit(a + 1)
    sampler.f[v] = position - a
  }
  return sampler
}

export class PcScene {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20)
  private readonly controls: OrbitControls
  /** Renders only the LEDs and glowing plastics, everything else in black, and blurs them. */
  private readonly bloomComposer: EffectComposer
  /** Renders the scene and adds the bloom on top. */
  private readonly composer: EffectComposer
  private readonly environment: THREE.Texture
  private readonly model: PcModel
  private readonly room: Room
  private readonly key = new THREE.DirectionalLight(0xdfe6ff, 0)
  private readonly darkBackground = new THREE.Color(BACKGROUND)
  private readonly deskBackground = backdropTexture()
  private readonly home = new THREE.Vector3()
  private readonly homeTarget = new THREE.Vector3()

  /** Meshes painted black (opaque) or hidden (transparent) while the bloom pass renders. */
  private readonly black = new THREE.MeshBasicMaterial({ color: 0x000000 })
  private readonly darkened: { mesh: THREE.Mesh; material: THREE.Mesh['material'] }[] = []
  private readonly hidden: { mesh: THREE.Mesh; visible: boolean }[] = []
  private shadowsDirty = true

  private sources: Partial<Record<PcModelPart, PartSource | null>> = {}
  /** Per device, three floats per LED. */
  private readonly deviceColors = new Map<string, DeviceColors>()
  private readonly samplers = new Map<LedStrip, Sampler>()
  private highlight: PcModelPart | null = null
  private motion = true
  private backdrop: PcModelBackdrop
  private ambient: number
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  private raf = 0
  private lastTime = 0
  private onScreen = false
  private interacting = false
  private lastInteraction = 0
  private reset: { from: THREE.Vector3; target: THREE.Vector3; progress: number } | null = null

  private readonly raycaster = new THREE.Raycaster()
  private pointer: { x: number; y: number; dirty: boolean } | null = null
  private pressedAt: { x: number; y: number } | null = null
  private hovered: PcModelPart | null = null

  private readonly cleanup: (() => void)[] = []

  constructor(private readonly options: PcSceneOptions) {
    this.canvas = options.canvas
    this.backdrop = options.backdrop
    this.ambient = THREE.MathUtils.clamp(options.ambient / 100, 0, 1)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance'
    })
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    // Only daylight casts shadows and the scenery is static: the map is rendered on demand.
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const studio = new RoomEnvironment()
    this.environment = pmrem.fromScene(studio, 0.04).texture
    studio.dispose()
    pmrem.dispose()
    this.scene.environment = this.environment

    this.key.position.set(1.2, 2, 2.2)
    this.scene.add(this.key)

    this.model = buildPcModel(this.environment)
    this.room = buildRoom()
    this.scene.add(this.model.root, this.room.group)

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    // The page scrolls with the wheel; zoom is on Ctrl + wheel (handled below).
    this.controls.enableZoom = false
    this.controls.rotateSpeed = 0.7
    this.controls.minDistance = 0.6
    this.controls.minPolarAngle = 0.25
    this.controls.maxPolarAngle = 1.72
    this.controls.autoRotateSpeed = SWAY_SPEED
    this.applyBackdrop()
    this.camera.position.copy(this.home)
    this.controls.target.copy(this.homeTarget)
    this.controls.update()

    this.bloomComposer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
    )
    this.bloomComposer.renderToScreen = false
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomComposer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.38, 0.22))

    const mix = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
        },
        vertexShader: MIX_VERTEX,
        fragmentShader: MIX_FRAGMENT
      }),
      'baseTexture'
    )
    mix.needsSwap = true
    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    )
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(mix)
    this.composer.addPass(new OutputPass())

    const glowing = new Set<THREE.Object3D>([...this.model.glowing, ...this.room.glowing])
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || glowing.has(object)) return
      const materials = (
        Array.isArray(object.material) ? object.material : [object.material]
      ) as THREE.Material[]
      if (materials.some((material) => material.transparent))
        this.hidden.push({ mesh: object, visible: true })
      else this.darkened.push({ mesh: object, material: object.material })
    })

    this.listen()
    this.resize()
  }

  setSources(sources: Partial<Record<PcModelPart, PartSource | null>>): void {
    this.sources = sources
  }

  setMotion(enabled: boolean): void {
    this.motion = enabled
  }

  /** Dims every other part, to show where a part sits in the case. */
  setHighlight(part: PcModelPart | null): void {
    this.highlight = part
  }

  setBackdrop(backdrop: PcModelBackdrop): void {
    if (backdrop === this.backdrop) return
    this.backdrop = backdrop
    this.applyBackdrop()
    this.resetView()
  }

  /** Room lighting in [0, 100]; the LEDs keep their own brightness. */
  setAmbient(value: number): void {
    this.ambient = THREE.MathUtils.clamp(value / 100, 0, 1)
    this.applyBackdrop()
    if (!this.raf) this.render()
  }

  resetView(): void {
    this.reset = { from: this.camera.position.clone(), target: this.controls.target.clone(), progress: 0 }
    this.lastInteraction = performance.now()
  }

  dispose(): void {
    this.stop()
    for (const dispose of this.cleanup) dispose()
    this.controls.dispose()
    for (const composer of [this.bloomComposer, this.composer]) {
      for (const pass of composer.passes) pass.dispose()
      composer.dispose()
    }
    this.model.dispose()
    this.room.dispose()
    this.black.dispose()
    this.deskBackground.dispose()
    this.environment.dispose()
    this.renderer.dispose()
  }

  /* ------------------------------- Backdrop ------------------------------- */

  private applyBackdrop(): void {
    const a = this.ambient
    const desk = this.backdrop === 'desk'
    const view = VIEWS[this.backdrop]
    this.room.group.visible = desk
    this.model.ground.visible = !desk
    this.scene.background = desk ? this.deskBackground : this.darkBackground
    this.scene.environmentIntensity = desk ? 0.015 + 0.08 * a : 0.04 + 0.24 * a
    this.key.intensity = desk ? 0 : 0.04 + 0.32 * a
    for (const dim of this.room.dimmers) dim(a)
    this.controls.maxDistance = view.maxDistance
    if (view.target) this.homeTarget.set(...view.target)
    else this.homeTarget.copy(this.model.center)
    this.home.setFromSphericalCoords(view.distance, view.polar, view.azimuth).add(this.homeTarget)
    this.shadowsDirty = true
  }

  /** Bloom from the glowing meshes only, then the full scene with the bloom added. */
  private render(): void {
    const background = this.scene.background
    this.scene.background = null
    for (const entry of this.darkened) entry.mesh.material = this.black
    for (const entry of this.hidden) {
      entry.visible = entry.mesh.visible
      entry.mesh.visible = false
    }
    this.bloomComposer.render()
    for (const entry of this.darkened) entry.mesh.material = entry.material
    for (const entry of this.hidden) entry.mesh.visible = entry.visible
    this.scene.background = background

    // After the bloom pass: shadows must be drawn with the real materials (double-sided leaves…).
    if (this.shadowsDirty) {
      this.renderer.shadowMap.needsUpdate = true
      this.shadowsDirty = false
    }
    this.composer.render()
  }

  /** Hides the walls standing between the camera and the PC. */
  private updateWalls(): void {
    if (!this.room.group.visible) return
    const eye = this.room.group.worldToLocal(this.camera.position.clone())
    for (const wall of this.room.walls) {
      wall.group.visible = eye.clone().sub(wall.point).dot(wall.normal) > 0
    }
  }

  /* --------------------------------- Loop --------------------------------- */

  private start(): void {
    if (this.raf) return
    this.lastTime = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private updateRunning(): void {
    if (this.onScreen && document.visibilityState === 'visible') this.start()
    else this.stop()
  }

  private readonly tick = (): void => {
    this.raf = requestAnimationFrame(this.tick)
    // performance.now() rather than the frame timestamp, which can lag behind `lastTime` set in start().
    const now = performance.now()
    if (now - this.lastTime < MIN_FRAME_MS) return
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000))
    this.lastTime = now
    const moving = this.motion && !this.reducedMotion.matches

    this.updateColors(dt)
    if (moving) {
      const step = dt * FAN_TURNS_PER_S * Math.PI * 2
      for (const rotor of this.model.rotors) rotor.rotation.z -= step
    }
    this.updateCamera(dt, now, moving)
    this.updateWalls()
    this.updatePointer()
    this.render()
  }

  private updateCamera(dt: number, now: number, moving: boolean): void {
    if (this.reset) {
      this.reset.progress = Math.min(1, this.reset.progress + dt / 0.7)
      const eased = 1 - (1 - this.reset.progress) ** 3
      this.camera.position.lerpVectors(this.reset.from, this.home, eased)
      this.controls.target.lerpVectors(this.reset.target, this.homeTarget, eased)
      if (this.reset.progress >= 1) this.reset = null
    }
    const idle = !this.interacting && !this.reset && now - this.lastInteraction > IDLE_BEFORE_SWAY_MS
    this.controls.autoRotate = moving && idle
    if (this.controls.autoRotate) {
      // Positive speeds decrease the azimuth: turn back whenever a bound is passed.
      const azimuth = this.controls.getAzimuthalAngle()
      if (azimuth > SWAY_MAX) this.controls.autoRotateSpeed = SWAY_SPEED
      else if (azimuth < SWAY_MIN) this.controls.autoRotateSpeed = -SWAY_SPEED
    }
    this.controls.update(dt)
  }

  /* -------------------------------- Colors -------------------------------- */

  private updateColors(dt: number): void {
    const ease = 1 - Math.exp(-dt / SMOOTHING_S)
    const target = new Float32Array(3)

    // Ease every device that feeds a part towards its latest frame.
    const needed = new Map<string, number>()
    for (const source of Object.values(this.sources)) {
      if (!source) continue
      needed.set(
        source.deviceId,
        Math.max(needed.get(source.deviceId) ?? 0, (source.start + source.count) * 3)
      )
    }
    for (const deviceId of this.deviceColors.keys()) {
      if (!needed.has(deviceId)) this.deviceColors.delete(deviceId)
    }
    for (const [deviceId, length] of needed) {
      let colors = this.deviceColors.get(deviceId)
      if (!colors || colors.eased.length < length) {
        const eased = new Float32Array(length)
        if (colors) eased.set(colors.eased)
        this.deviceColors.set(deviceId, (colors = { eased, glow: new Float32Array(length) }))
      }
      const { eased, glow } = colors
      const frame = frameStore.get(deviceId)
      for (let i = 0; i + 2 < eased.length; i += 3) {
        if (frame && i + 2 < frame.length) emission(frame, i, target)
        else target.fill(0)
        for (let c = 0; c < 3; c++) eased[i + c]! += (target[c]! - eased[i + c]!) * ease
        const boost = perceivedBoost(eased[i]!, eased[i + 1]!, eased[i + 2]!)
        for (let c = 0; c < 3; c++) glow[i + c] = eased[i + c]! * boost
      }
    }

    for (const strip of this.model.strips) this.paintStrip(strip)

    const average = new THREE.Color()
    for (const glow of this.model.glows) {
      this.averageOf(glow.part, glow.from, glow.to, average)
      glow.material.emissive.copy(average).multiplyScalar(glow.strength * this.emphasis(glow.part))
    }
    const total = new THREE.Color()
    let lit = 0
    for (const { part, light, from, to, strength } of this.model.lights) {
      this.averageOf(part, from, to, average)
      this.aim(light, average, LIGHT_GAIN * strength * this.emphasis(part))
      if (this.sources[part]) {
        total.add(average)
        lit++
      }
    }
    total.multiplyScalar(1 / Math.max(1, lit))
    for (const { light, gain } of this.model.fills)
      this.aim(light, total, this.highlight ? 0 : FILL_GAIN * gain)
  }

  /** Points a light at a color: hue from its ratios, intensity from its brightest channel. */
  private aim(light: THREE.PointLight, color: THREE.Color, gain: number): void {
    const peak = Math.max(color.r, color.g, color.b)
    light.intensity = peak > 1e-4 ? gain * peak : 0
    if (peak > 1e-4) light.color.setRGB(color.r / peak, color.g / peak, color.b / peak)
  }

  private emphasis(part: PcModelPart): number {
    if (!this.highlight) return 1
    return part === this.highlight ? 1.2 : DIMMED
  }

  private paintStrip(strip: LedStrip): void {
    const out = strip.colors.array as Float32Array
    const source = this.sources[strip.part]
    const device = source ? this.deviceColors.get(source.deviceId)?.glow : undefined
    const emphasis = this.emphasis(strip.part)
    const off = LED_OFF * Math.min(1, emphasis)
    if (!source || !device) {
      out.fill(off)
      strip.colors.needsUpdate = true
      return
    }
    let sampler = this.samplers.get(strip)
    if (!sampler || sampler.count !== source.count) {
      sampler = buildSampler(strip, source.count)
      this.samplers.set(strip, sampler)
    }
    const gain = LED_GAIN * strip.gain * emphasis
    const base = source.start * 3
    for (let v = 0; v < sampler.a.length; v++) {
      const a = base + sampler.a[v]! * 3
      const b = base + sampler.b[v]! * 3
      const f = sampler.f[v]!
      for (let c = 0; c < 3; c++) {
        const from = device[a + c] ?? 0
        out[v * 3 + c] = off + (from + ((device[b + c] ?? 0) - from) * f) * gain
      }
    }
    strip.colors.needsUpdate = true
  }

  private averageOf(part: PcModelPart, from: number, to: number, out: THREE.Color): void {
    out.setRGB(0, 0, 0)
    const source = this.sources[part]
    const device = source ? this.deviceColors.get(source.deviceId)?.glow : undefined
    if (!source || !device) return
    const [lo, hi] = ledRange(from, to, source.count)
    for (let led = lo; led <= hi; led++) {
      const i = (source.start + led) * 3
      out.r += device[i] ?? 0
      out.g += device[i + 1] ?? 0
      out.b += device[i + 2] ?? 0
    }
    out.multiplyScalar(1 / (hi - lo + 1))
  }

  /* ---------------------------- Pointer & size ---------------------------- */

  private updatePointer(): void {
    if (!this.pointer?.dirty) return
    this.pointer.dirty = false
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((this.pointer.x - rect.left) / rect.width) * 2 - 1,
      -((this.pointer.y - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.intersectObjects(this.model.pickables, false)[0]
    this.hovered = (hit?.object.userData['part'] as PcModelPart | undefined) ?? null
    this.canvas.style.cursor = this.interacting ? 'grabbing' : this.hovered ? 'pointer' : 'grab'
    this.options.onHover(this.hovered, this.pointer.x, this.pointer.y)
  }

  private resize(): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    for (const composer of [this.bloomComposer, this.composer]) {
      composer.setPixelRatio(this.renderer.getPixelRatio())
      composer.setSize(width, height)
    }
    this.camera.aspect = width / height
    // Keep the whole case in frame on narrow layouts.
    this.camera.fov = width / height < 1.25 ? 38 : 30
    this.camera.updateProjectionMatrix()
    if (!this.raf) this.render()
  }

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions
    ): void => {
      target.addEventListener(type, listener, options)
      this.cleanup.push(() => target.removeEventListener(type, listener, options))
    }

    const onStart = (): void => {
      this.interacting = true
      this.reset = null
    }
    const onEnd = (): void => {
      this.interacting = false
      this.lastInteraction = performance.now()
    }
    this.controls.addEventListener('start', onStart)
    this.controls.addEventListener('end', onEnd)
    this.cleanup.push(() => {
      this.controls.removeEventListener('start', onStart)
      this.controls.removeEventListener('end', onEnd)
    })

    on(this.canvas, 'pointermove', (event) => {
      this.pointer = { x: event.clientX, y: event.clientY, dirty: true }
    })
    on(this.canvas, 'pointerleave', () => {
      this.pointer = null
      this.hovered = null
      this.options.onHover(null, 0, 0)
    })
    on(this.canvas, 'pointerdown', (event) => {
      this.pressedAt = { x: event.clientX, y: event.clientY }
    })
    on(this.canvas, 'pointerup', (event) => {
      const pressed = this.pressedAt
      this.pressedAt = null
      if (!pressed || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 4) return
      if (this.hovered) this.options.onSelect(this.hovered)
    })
    on(this.canvas, 'dblclick', () => this.resetView())
    on(
      this.canvas,
      'wheel',
      (event) => {
        if (!event.ctrlKey) return
        event.preventDefault()
        this.reset = null
        this.lastInteraction = performance.now()
        const offset = this.camera.position.clone().sub(this.controls.target)
        const distance = THREE.MathUtils.clamp(
          offset.length() * Math.exp(event.deltaY * 0.0015),
          this.controls.minDistance,
          this.controls.maxDistance
        )
        this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), distance)
      },
      { passive: false }
    )

    const resizeObserver = new ResizeObserver(() => this.resize())
    resizeObserver.observe(this.canvas)
    const intersection = new IntersectionObserver(([entry]) => {
      this.onScreen = entry?.isIntersecting ?? false
      this.updateRunning()
    })
    intersection.observe(this.canvas)
    const onVisibility = (): void => this.updateRunning()
    document.addEventListener('visibilitychange', onVisibility)
    this.cleanup.push(() => {
      resizeObserver.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    })
  }
}
