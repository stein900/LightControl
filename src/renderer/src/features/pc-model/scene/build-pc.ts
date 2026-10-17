/**
 * Procedural model of the PC: a dual-chamber case with glass front and side,
 * 360 mm AIO on top, three side, three bottom and one rear fan, two memory
 * sticks, a horizontal graphics card and two Strimer cables.
 *
 * Units are centimetres. x runs from the rear (-24) to the front (+24), y from
 * the floor (0) to the top (46), z from the rear chamber (-15) to the side
 * glass (+15); the motherboard tray sits at z = -9.
 *
 * Every lit surface is an `LedStrip`: its vertices carry their position along
 * the LED chain of a part, so the scene can paint them from live LED colors.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { PcModelPart } from '@shared/model'
import {
  backplateTexture,
  finsTexture,
  glassStreakTexture,
  gpuSideTexture,
  honeycombTexture,
  labelTexture,
  pcbTexture,
  plateTexture,
  radialTexture,
  sailsTexture,
  slotsTexture
} from './textures'

export interface LedStrip {
  part: PcModelPart
  colors: THREE.BufferAttribute
  /** Position of each vertex along the part's LED chain, in [0, 1]. */
  chain: Float32Array
  /** Stretch of the chain the strip covers; closed strips (rings) wrap inside it. */
  from: number
  to: number
  closed: boolean
  gain: number
}

/** Material whose emissive color follows the average of a stretch of LEDs (fan blades, pump shell). */
export interface Glow {
  part: PcModelPart
  material: THREE.MeshStandardMaterial
  from: number
  to: number
  strength: number
}

/** Light cast by a stretch of LEDs (one fan, a memory stick…) onto its surroundings. */
export interface PartLight {
  part: PcModelPart
  light: THREE.PointLight
  from: number
  to: number
  strength: number
}

export interface PcModel {
  root: THREE.Group
  strips: LedStrip[]
  glows: Glow[]
  lights: PartLight[]
  /**
   * Lights following the average LED color: one inside the case, and two
   * outside that spill onto the desk and the wall behind, as light leaking
   * through the glass does. `gain` is relative to the inside one.
   */
  fills: { light: THREE.PointLight; gain: number }[]
  /** Glow under the case, for the dark backdrop only. */
  ground: THREE.Mesh
  /** LEDs and glowing plastics: the only meshes the bloom pass keeps. */
  glowing: THREE.Mesh[]
  /** Fan blades, spun by the scene. */
  rotors: THREE.Object3D[]
  /** Meshes that identify a part under the pointer (`userData.part`). */
  pickables: THREE.Object3D[]
  /** Centre of the case, in scene units (metres). */
  center: THREE.Vector3
  dispose(): void
}

type Vec = readonly [number, number, number]
type Faces = Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', THREE.Material>>

const FAN_DEPTH = 2.5
const TAU = Math.PI * 2
const AXIS_Z = new THREE.Vector3(0, 0, 1)

/** Angle around the local z axis, as a fraction of a turn. */
const ringParam = (p: THREE.Vector3): number => (Math.atan2(p.y, p.x) / TAU + 1) % 1

const axisParam =
  (axis: 'x' | 'y' | 'z', min: number, max: number) =>
  (p: THREE.Vector3): number =>
    (p[axis] - min) / (max - min)

/** TubeGeometry lays its vertices out ring by ring along the curve. */
const tubeParam =
  (tubular: number, radial: number) =>
  (_p: THREE.Vector3, index: number): number =>
    Math.floor(index / (radial + 1)) / tubular

/* ------------------------------- Geometries ------------------------------- */

/** 120 mm frame: rounded square, round duct and four screw holes, slightly bevelled. */
function fanFrameGeometry(): THREE.BufferGeometry {
  const half = 6
  const corner = 1.2
  const shape = new THREE.Shape()
  shape.moveTo(-half + corner, -half)
  shape.lineTo(half - corner, -half)
  shape.absarc(half - corner, -half + corner, corner, -Math.PI / 2, 0, false)
  shape.lineTo(half, half - corner)
  shape.absarc(half - corner, half - corner, corner, 0, Math.PI / 2, false)
  shape.lineTo(-half + corner, half)
  shape.absarc(-half + corner, half - corner, corner, Math.PI / 2, Math.PI, false)
  shape.lineTo(-half, -half + corner)
  shape.absarc(-half + corner, -half + corner, corner, Math.PI, Math.PI * 1.5, false)
  const duct = new THREE.Path()
  duct.absarc(0, 0, 5.8, 0, TAU, true)
  shape.holes.push(duct)
  for (const [x, y] of [
    [5.15, 5.15],
    [-5.15, 5.15],
    [-5.15, -5.15],
    [5.15, -5.15]
  ] as const) {
    const screw = new THREE.Path()
    screw.absarc(x, y, 0.32, 0, TAU, true)
    shape.holes.push(screw)
  }
  const depth = FAN_DEPTH - 0.2
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.08,
    bevelSegments: 2,
    curveSegments: 40
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

/** Swept, pitched blades: leading edges stand forward, so they read as blades from any angle. */
function bladesGeometry(count: number, inner: number, outer: number): THREE.BufferGeometry {
  const rows = 10
  const cols = 4
  const positions: number[] = []
  const indices: number[] = []
  for (let blade = 0; blade < count; blade++) {
    const base = (blade / count) * TAU
    const first = positions.length / 3
    for (let i = 0; i <= rows; i++) {
      const t = i / rows
      const radius = inner + (outer - inner) * t
      const sweep = 0.55 * t
      const width = (TAU / count) * (0.62 + 0.18 * t)
      for (let j = 0; j <= cols; j++) {
        const u = j / cols
        const angle = base + sweep + width * u
        const pitch = (0.5 - u) * 1.15 * (1 - 0.35 * t)
        positions.push(radius * Math.cos(angle), radius * Math.sin(angle), pitch)
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = first + i * (cols + 1) + j
        const b = a + cols + 1
        indices.push(a, b, a + 1, a + 1, b, b + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Four motor arms behind the blades. */
function strutsGeometry(): THREE.BufferGeometry {
  const arms = [0, 1, 2, 3].map((k) => {
    const arm = new THREE.BoxGeometry(3.95, 0.38, 0.4)
    arm.translate(3.85, 0, 0)
    arm.rotateZ(Math.PI / 4 + (k * Math.PI) / 2)
    return arm
  })
  const merged = mergeGeometries(arms) ?? new THREE.BufferGeometry()
  for (const arm of arms) arm.dispose()
  return merged
}

/* --------------------------------- Builder -------------------------------- */

class Builder {
  readonly root = new THREE.Group()
  readonly strips: LedStrip[] = []
  readonly glows: Glow[] = []
  readonly lights: PartLight[] = []
  readonly rotors: THREE.Object3D[] = []
  readonly pickables: THREE.Object3D[] = []

  readonly led = new THREE.MeshBasicMaterial({ vertexColors: true })
  readonly chassis = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, metalness: 0.55, roughness: 0.42 })
  readonly glass = new THREE.MeshPhysicalMaterial({
    color: 0x0c0c12,
    metalness: 0,
    // Slightly frosted: a mirror-smooth pane turns each LED light into a hard dot.
    roughness: 0.14,
    specularIntensity: 0.5,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false
  })
  readonly streak = new THREE.MeshBasicMaterial({
    map: glassStreakTexture(),
    transparent: true,
    opacity: 0.07,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  readonly metal = new THREE.MeshStandardMaterial({ color: 0xc4c7ce, metalness: 0.85, roughness: 0.3 })
  readonly white = new THREE.MeshStandardMaterial({ color: 0xe2e3e8, metalness: 0.05, roughness: 0.45 })
  readonly fanBlack = new THREE.MeshStandardMaterial({ color: 0x131316, metalness: 0.15, roughness: 0.5 })
  readonly dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.15, roughness: 0.75 })
  readonly grey = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.3, roughness: 0.55 })
  readonly gpu = new THREE.MeshStandardMaterial({ color: 0x1b1c20, metalness: 0.6, roughness: 0.4 })
  readonly rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0, roughness: 0.6 })
  readonly sleeve = new THREE.MeshStandardMaterial({ color: 0x101012, metalness: 0.1, roughness: 0.85 })

  private readonly fanFrame = fanFrameGeometry()
  private readonly fanBlades = bladesGeometry(9, 1.95, 5.6)
  private readonly fanStruts = strutsGeometry()
  private readonly gpuBlades = bladesGeometry(11, 1.6, 4.3)

  constructor(reflections: THREE.Texture) {
    this.root.scale.setScalar(0.01) // centimetres to metres: keeps light falloff physically plausible
    // Glass and bare metal mirror the room more than the scene-wide environment allows.
    this.glass.envMap = reflections
    this.glass.envMapIntensity = 1.1
    this.metal.envMap = reflections
    this.metal.envMapIntensity = 0.5
  }

  /** Copy of `base` with a texture. */
  textured(
    base: THREE.MeshStandardMaterial,
    map: THREE.Texture,
    color = 0xffffff
  ): THREE.MeshStandardMaterial {
    const material = base.clone()
    material.map = map
    material.color.set(color)
    return material
  }

  mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    at: Vec,
    parent: THREE.Object3D = this.root,
    part?: PcModelPart
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...at)
    parent.add(mesh)
    if (part) {
      mesh.userData['part'] = part
      this.pickables.push(mesh)
    }
    return mesh
  }

  box(size: Vec, material: THREE.Material, at: Vec, parent?: THREE.Object3D, part?: PcModelPart): THREE.Mesh {
    return this.mesh(new THREE.BoxGeometry(...size), material, at, parent, part)
  }

  /** Box with its own material on some faces (a decal on the front, a grille on top…). */
  faced(size: Vec, base: THREE.Material, faces: Faces, at: Vec): THREE.Mesh {
    const materials = [faces.px, faces.nx, faces.py, faces.ny, faces.pz, faces.nz].map((face) => face ?? base)
    return this.mesh(new THREE.BoxGeometry(...size), materials, at)
  }

  rounded(size: Vec, radius: number, material: THREE.Material, at: Vec, part?: PcModelPart): THREE.Mesh {
    return this.mesh(
      new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius),
      material,
      at,
      this.root,
      part
    )
  }

  /** Cylinder lying along z. */
  cylinder(
    radius: number,
    length: number,
    material: THREE.Material,
    at: Vec,
    parent?: THREE.Object3D
  ): THREE.Mesh {
    const mesh = this.mesh(new THREE.CylinderGeometry(radius, radius, length, 28), material, at, parent)
    mesh.rotation.x = Math.PI / 2
    return mesh
  }

  plane(width: number, height: number, material: THREE.Material, at: Vec, facing: Vec): THREE.Mesh {
    const mesh = this.mesh(new THREE.PlaneGeometry(width, height), material, at)
    mesh.quaternion.setFromUnitVectors(AXIS_Z, new THREE.Vector3(...facing))
    return mesh
  }

  /** Adds an LED surface; `param` gives each vertex's position along the strip, in [0, 1]. */
  strip(
    part: PcModelPart,
    geometry: THREE.BufferGeometry,
    param: (position: THREE.Vector3, index: number) => number,
    from: number,
    to: number,
    at: Vec,
    options: { parent?: THREE.Object3D; closed?: boolean; gain?: number } = {}
  ): THREE.Mesh {
    const position = geometry.getAttribute('position')
    const chain = new Float32Array(position.count)
    const point = new THREE.Vector3()
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i)
      chain[i] = from + (to - from) * Math.min(1, Math.max(0, param(point, i)))
    }
    const colors = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3)
    colors.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('color', colors)
    this.strips.push({
      part,
      colors,
      chain,
      from,
      to,
      closed: options.closed ?? false,
      gain: options.gain ?? 1
    })
    return this.mesh(geometry, this.led, at, options.parent, part)
  }

  light(part: PcModelPart, at: Vec, strength: number, from = 0, to = 1): void {
    // Short reach: lights the parts around it, not the glass, where it would show as a dot.
    const light = new THREE.PointLight(0xffffff, 0, 0.16, 2)
    light.position.set(...at)
    this.root.add(light)
    this.lights.push({ part, light, from, to, strength })
  }

  glow(part: PcModelPart, material: THREE.MeshStandardMaterial, strength: number, from = 0, to = 1): void {
    this.glows.push({ part, material, from, to, strength })
  }

  /** A 120 mm fan whose lit face points along `facing`; it covers [from, to) of its part's chain. */
  fan(part: PcModelPart, from: number, to: number, at: Vec, facing: Vec): void {
    const group = new THREE.Group()
    group.position.set(...at)
    const normal = new THREE.Vector3(...facing)
    group.quaternion.setFromUnitVectors(AXIS_Z, normal)
    this.root.add(group)
    const front = FAN_DEPTH / 2

    // Black frame and motor; the smoked blades carry the light.
    this.mesh(this.fanFrame, this.fanBlack, [0, 0, 0], group, part)
    this.mesh(this.fanStruts, this.fanBlack, [0, 0, -0.95], group)
    this.cylinder(1.9, 2.2, this.fanBlack, [0, 0, -0.05], group)
    this.mesh(new THREE.CircleGeometry(1.32, 36), this.grey, [0, 0, front - 0.07], group)

    // Bright ring around the hub and a softer one along the duct.
    this.strip(part, new THREE.TorusGeometry(1.62, 0.27, 10, 72), ringParam, from, to, [0, 0, front - 0.12], {
      parent: group,
      closed: true
    })
    this.strip(part, new THREE.TorusGeometry(5.66, 0.16, 8, 96), ringParam, from, to, [0, 0, front - 0.18], {
      parent: group,
      closed: true,
      gain: 0.7
    })

    const blades = new THREE.MeshStandardMaterial({
      color: 0x34353b,
      metalness: 0,
      roughness: 0.45,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const rotor = new THREE.Group()
    rotor.position.z = 0.15
    rotor.rotation.z = Math.random() * TAU
    group.add(rotor)
    this.mesh(this.fanBlades, blades, [0, 0, 0], rotor, part)
    this.rotors.push(rotor)
    this.glow(part, blades, 0.75, from, to)

    const lightAt = new THREE.Vector3(...at).addScaledVector(normal, 6)
    this.light(part, [lightAt.x, lightAt.y, lightAt.z], 0.6, from, to)
  }

  /** Unlit fan under the graphics card. */
  gpuFan(at: Vec): void {
    const group = new THREE.Group()
    group.position.set(...at)
    group.quaternion.setFromUnitVectors(AXIS_Z, new THREE.Vector3(0, -1, 0))
    this.root.add(group)
    this.mesh(new THREE.TorusGeometry(4.55, 0.22, 8, 48), this.grey, [0, 0, 0], group)
    this.mesh(this.gpuBlades, this.dark, [0, 0, -0.2], group)
    this.cylinder(1.5, 0.8, this.grey, [0, 0, 0], group)
  }

  /**
   * Strimer cable: `lines` parallel light pipes on a black cable bundle, following
   * `points` and chained one after the other. `width` is the initial direction
   * across the ribbon, `facing` the side the light pipes face.
   */
  ribbon(part: PcModelPart, points: Vec[], lines: number, spacing: number, width: Vec, facing: Vec): void {
    const samples = 110
    const radial = 6
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      false,
      'centripetal'
    )
    const centre = curve.getSpacedPoints(samples)
    const across = new THREE.Vector3(...width)
    const backs: THREE.Vector3[] = []
    const offsets = centre.map((_, i) => {
      // Parallel transport keeps the ribbon flat instead of twisting along the curve.
      const tangent = curve.getTangentAt(i / samples)
      across.addScaledVector(tangent, -across.dot(tangent)).normalize()
      backs.push(new THREE.Vector3().crossVectors(tangent, across).normalize())
      return across.clone()
    })
    // The bundle lies behind the pipes, away from the side they face.
    if (backs[0]!.dot(new THREE.Vector3(...facing)) > 0) for (const back of backs) back.negate()

    for (let line = 0; line < lines; line++) {
      const shift = (line - (lines - 1) / 2) * spacing
      const pipe = centre.map((p, i) => p.clone().addScaledVector(offsets[i]!, shift))
      const wire = pipe.map((p, i) => p.clone().addScaledVector(backs[i]!, 0.2))
      this.mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wire), samples, 0.21, 6),
        this.sleeve,
        [0, 0, 0]
      )
      this.strip(
        part,
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pipe), samples, 0.15, radial, false),
        tubeParam(samples, radial),
        line / lines,
        (line + 1) / lines,
        [0, 0, 0]
      )
    }
    const middle = curve.getPointAt(0.5)
    this.light(part, [middle.x, middle.y, middle.z + 2], 0.5)
  }

  tube(points: Vec[], radius: number, material: THREE.Material = this.rubber): void {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...p)),
      false,
      'centripetal'
    )
    this.mesh(new THREE.TubeGeometry(curve, 64, radius, 12, false), material, [0, 0, 0])
  }
}

/* ---------------------------------- Parts --------------------------------- */

function buildCase(b: Builder): THREE.Mesh {
  const grille = (repeat: [number, number]): THREE.MeshStandardMaterial =>
    b.textured(b.chassis, honeycombTexture(repeat))

  // Floor and top carry honeycomb grilles; rear panel, rear-chamber side, tray.
  b.faced([48, 0.6, 30], b.chassis, { py: grille([16, 6]) }, [0, 0.3, 0])
  b.faced([48, 0.6, 30], b.chassis, { py: grille([16, 6]) }, [0, 45.7, 0])
  b.box([0.6, 44.8, 30], b.chassis, [-23.7, 23, 0])
  b.box([48, 44.8, 0.6], b.chassis, [0, 23, -14.7])
  b.box([47.4, 44.8, 0.4], b.chassis, [0.3, 23, -9.2])
  b.box([0.8, 44.8, 0.8], b.chassis, [23.6, 23, -14.6])
  b.box([0.25, 44.8, 0.25], b.chassis, [23.9, 23, 14.9]) // glass-to-glass joint

  // Rear panel, inside: grille behind the exhaust fan, slot covers below.
  b.plane(13, 13, grille([4, 2.5]), [-23.38, 31, 1], [1, 0, 0])
  b.plane(13, 17, b.textured(b.chassis, slotsTexture()), [-23.38, 11, -2.2], [1, 0, 0])

  // Rubber grommets in the tray where the cables cross over.
  b.box([1.6, 22, 0.2], b.rubber, [7.6, 27, -8.95])
  b.box([1.2, 6, 0.2], b.rubber, [-18, 42, -8.95])

  // Power supply in the rear chamber, seen through the front glass.
  b.rounded([16, 8.5, 4.8], 0.3, b.chassis, [12, 5, -12])

  // Long feet under the front and rear edges.
  for (const x of [-19.5, 19.5]) b.rounded([5, 2.2, 27], 0.5, b.chassis, [x, -1.1, 0])

  // Pillarless glass on the front and the side, with faint reflections over it.
  b.mesh(new THREE.PlaneGeometry(48, 44.8), b.glass, [0, 23, 15]).renderOrder = 2
  const front = b.mesh(new THREE.PlaneGeometry(30, 44.8), b.glass, [24, 23, 0])
  front.rotation.y = Math.PI / 2
  front.renderOrder = 2
  b.mesh(new THREE.PlaneGeometry(48, 44.8), b.streak, [0, 23, 15.03]).renderOrder = 3
  const frontStreak = b.mesh(new THREE.PlaneGeometry(30, 44.8), b.streak, [24.03, 23, 0])
  frontStreak.rotation.y = Math.PI / 2
  frontStreak.renderOrder = 3

  // Vertical light bar along the front edge of the rear chamber.
  b.box([0.6, 39, 1.4], b.chassis, [23.2, 23, -12.4])
  b.strip(
    'case-strip',
    new THREE.BoxGeometry(0.45, 38, 1, 1, 76, 1),
    axisParam('y', -19, 19),
    0,
    1,
    [23.55, 23, -12.4]
  )
  b.light('case-strip', [21, 23, -11], 0.5)

  // Floor glow.
  const ground = new THREE.MeshStandardMaterial({
    color: 0x1a1a20,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    alphaMap: radialTexture()
  })
  const floor = b.mesh(new THREE.CircleGeometry(85, 64), ground, [0, -2.2, 0])
  floor.rotation.x = -Math.PI / 2
  return floor
}

function buildMotherboard(b: Builder): void {
  const pcb = new THREE.MeshStandardMaterial({ map: pcbTexture(), metalness: 0.3, roughness: 0.6 })
  b.faced([24.4, 30.5, 0.2], b.dark, { pz: pcb }, [-9.3, 24.75, -8.9])
  b.plane(4, 13.5, b.metal, [-23.35, 33.4, -7], [1, 0, 0]) // I/O shield

  // Rear I/O cover and heatsinks.
  b.faced([3.4, 13, 3.6], b.metal, { pz: b.textured(b.metal, plateTexture(3)) }, [-19.8, 33.4, -7])
  b.faced(
    [12, 3.2, 2.6],
    b.metal,
    { pz: b.textured(b.metal, finsTexture([7, 1], true)) },
    [-11.3, 37.7, -7.5]
  )
  b.faced([2.8, 11.5, 2.6], b.metal, { pz: b.textured(b.metal, finsTexture([1, 6])) }, [-16.7, 29.6, -7.5])
  const logo = new THREE.MeshStandardMaterial({
    map: labelTexture('msi', 256, 80, 'italic 800 58px', '#1c1d21'),
    transparent: true,
    metalness: 0.2,
    roughness: 0.5
  })
  b.plane(4.4, 1.4, logo, [-11.3, 37.7, -6.17], [0, 0, 1])
  b.faced([9, 5, 1.3], b.metal, { pz: b.textured(b.metal, plateTexture(9, 'msi')) }, [-2.5, 12.8, -8.15])
  b.faced([11.5, 2.4, 0.6], b.metal, { pz: b.textured(b.metal, plateTexture(4)) }, [-11, 21.9, -8.5])
  b.faced([11.5, 2.4, 0.6], b.metal, { pz: b.textured(b.metal, plateTexture(5)) }, [-11, 10.9, -8.5])

  // Slots, connectors and capacitors.
  b.box([9.2, 0.95, 1.05], b.metal, [-12.5, 19.7, -8.3]) // reinforced PCIe x16
  b.box([1.4, 6.4, 2.2], b.dark, [2.2, 30, -7.7]) // 24-pin
  for (let i = 0; i < 4; i++) b.box([1.1, 0.75, 1.3], b.dark, [2.3, 13 + i, -8.15]) // SATA
  for (const x of [-19.4, -16.8]) b.box([2.2, 1, 1.6], b.dark, [x, 39.4, -8]) // CPU power
  for (let i = 0; i < 5; i++) b.cylinder(0.36, 0.9, b.grey, [-14.6, 25 + i * 1.9, -8.35])

  // CPU power cables up to the top grommet.
  for (const x of [-19.4, -16.8]) {
    b.tube(
      [
        [x, 39.9, -7.6],
        [x, 41.3, -7.4],
        [x + 0.6, 42.4, -8.4],
        [x + 0.9, 42.6, -9.6]
      ],
      0.42,
      b.sleeve
    )
  }

  // Memory: four slots with latches, sticks in the second and fourth.
  for (const x of [-4.6, -3.65, -2.7, -1.75]) {
    b.box([0.6, 14.6, 0.7], b.dark, [x, 29.45, -8.45])
    for (const y of [22.05, 36.85]) b.box([0.62, 0.6, 1.2], b.grey, [x, y, -8])
  }
  ;[-3.65, -1.75].forEach((x, stick) => {
    b.box([0.72, 13.4, 3.7], b.white, [x, 29.45, -6.95], undefined, 'memory')
    b.strip(
      'memory',
      new THREE.BoxGeometry(0.66, 13.2, 1.1, 1, 44, 1),
      axisParam('y', -6.6, 6.6),
      stick / 2,
      (stick + 1) / 2,
      [x, 29.45, -4.55]
    )
  })
  b.light('memory', [-2.7, 29.5, -1], 0.45)
}

function buildCooling(b: Builder): void {
  // AIO pump block: white shell, dark cap with a lit emblem, LED ring.
  const shell = new THREE.MeshStandardMaterial({ color: 0xeef0f4, metalness: 0.05, roughness: 0.4 })
  b.rounded([7.2, 7.2, 2.6], 1.1, shell, [-10, 29.5, -7.5], 'pump')
  b.glow('pump', shell, 0.12)
  b.cylinder(2.85, 0.7, b.gpu, [-10, 29.5, -5.85])
  b.strip('pump', new THREE.TorusGeometry(3.05, 0.27, 10, 80), ringParam, 0, 1, [-10, 29.5, -6.05], {
    closed: true
  })
  b.strip('pump', new THREE.TorusGeometry(2.62, 0.08, 6, 64), ringParam, 0, 1, [-10, 29.5, -5.5], {
    closed: true,
    gain: 0.6
  })
  const sails = sailsTexture()
  const emblem = new THREE.MeshStandardMaterial({
    map: sails,
    emissiveMap: sails,
    transparent: true,
    metalness: 0,
    roughness: 0.4
  })
  b.plane(2.8, 2.8, emblem, [-10, 29.5, -5.48], [0, 0, 1])
  b.glow('pump', emblem, 0.8)
  b.light('pump', [-10, 29.5, -2.5], 0.5)

  // Radiator under the top panel, tubes from the pump to its front tank.
  b.box([41, 2.7, 12.4], b.chassis, [1, 44.05, 3])
  for (const z of [0.5, 3.5]) {
    b.mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.2, 20), b.metal, [20, 42.2, z])
  }
  for (const y of [30.6, 28.4]) b.cylinder(0.85, 1, b.metal, [-6.3, y, -7.3]).rotation.set(0, 0, Math.PI / 2)
  b.tube(
    [
      [-6.6, 30.6, -7.3],
      [-3.5, 31.4, -2.3],
      [3, 33.6, 0.3],
      [11, 37, 0.8],
      [17.5, 40, 0.6],
      [20, 41.8, 0.5]
    ],
    0.65
  )
  b.tube(
    [
      [-6.6, 28.4, -7.3],
      [-2.5, 28.2, -1.4],
      [5, 30.5, 3.2],
      [13, 35.5, 3.8],
      [18.5, 39.5, 3.6],
      [20, 41.8, 3.5]
    ],
    0.65
  )

  const xs = [-11.5, 0.5, 12.5]
  xs.forEach((x, i) => b.fan('top-fans', i / 3, (i + 1) / 3, [x, 41.45, 3], [0, -1, 0]))
  xs.forEach((x, i) => b.fan('bottom-fans', i / 3, (i + 1) / 3, [x, 1.85, 3], [0, 1, 0]))
  // Side intake column on the tray, bottom to top.
  ;[9, 21.25, 33.5].forEach((y, i) => b.fan('side-fans', i / 3, (i + 1) / 3, [15, y, -7.75], [0, 0, 1]))
  b.fan('rear-fan', 0, 1, [-22.15, 31, 1], [1, 0, 0])
}

function buildGraphicsCard(b: Builder): void {
  const side = b.textured(b.gpu, gpuSideTexture())
  const backplate = b.textured(b.gpu, backplateTexture())
  backplate.metalness = 0.7
  const fins = b.textured(b.gpu, finsTexture([1, 3]), 0x55575e)
  b.faced([32, 7, 13.6], b.gpu, { pz: side, py: backplate, px: fins }, [-7, 15.7, -1.8])
  b.box([0.2, 8.6, 12.4], b.metal, [-23.2, 15.5, -2.6]) // bracket
  b.box([2.8, 0.9, 1.8], b.dark, [-11, 19.65, 2.8]) // power connector
  for (const x of [-18, -7.5, 3]) b.gpuFan([x, 12.1, -1.8])
}

function buildCables(b: Builder): void {
  // 24-pin Strimer: loops out of the motherboard connector into the tray grommet.
  b.box([1.6, 6.6, 2], b.dark, [3.6, 30, -7.6])
  b.ribbon(
    'atx-cable',
    [
      [4.4, 30, -7.6],
      [5.4, 30, -6],
      [6, 30, -2.8],
      [7.6, 30, -1.6],
      [8.8, 30, -4.4],
      [8.4, 30, -9.1]
    ],
    6,
    0.75,
    [0, 1, 0],
    [0, 0, 1]
  )

  // GPU Strimer: rises from the card, sweeps in front of the memory, dives behind the tray.
  b.box([2.6, 1.2, 1.6], b.dark, [-11, 20.4, 2.8])
  b.ribbon(
    'gpu-cable',
    [
      [-11, 21, 2.8],
      [-11, 22.6, 3],
      [-8.5, 24.3, 3.2],
      [-3, 24.7, 2.8],
      [2.5, 24.3, 1.8],
      [6.2, 23.9, -2],
      [7.4, 23.7, -9.1]
    ],
    6,
    0.42,
    [1, 0, 0],
    [0, 0, 1]
  )
}

/** `reflections` is the environment map mirrored by the glass and bare metal. */
export function buildPcModel(reflections: THREE.Texture): PcModel {
  const b = new Builder(reflections)
  const ground = buildCase(b)
  buildMotherboard(b)
  buildCooling(b)
  buildGraphicsCard(b)
  buildCables(b)

  const spots: [at: Vec, gain: number, reach: number][] = [
    [[0, 24, 4], 1, 0],
    [[0, 30, -32], 5, 1.4], // halo on the wall behind
    [[0, 6, 32], 3, 1.1] // spill on the desk in front of the glass
  ]
  const fills = spots.map(([at, gain, reach]) => {
    const light = new THREE.PointLight(0xffffff, 0, reach, 2)
    light.position.set(...at)
    b.root.add(light)
    return { light, gain }
  })

  // Opaque parts cast and receive the daylight shadows; LEDs, glass and blades do not.
  const glowMaterials = new Set<THREE.Material>([b.led, ...b.glows.map((glow) => glow.material)])
  const glowing: THREE.Mesh[] = []
  b.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object === ground) return
    const materials = (
      Array.isArray(object.material) ? object.material : [object.material]
    ) as THREE.Material[]
    if (materials.some((material) => glowMaterials.has(material))) glowing.push(object)
    const opaque = materials.every((material) => !material.transparent)
    object.castShadow = opaque && object.material !== b.led
    object.receiveShadow = opaque
  })

  return {
    root: b.root,
    strips: b.strips,
    glows: b.glows,
    lights: b.lights,
    fills,
    ground,
    glowing,
    rotors: b.rotors,
    pickables: b.pickables,
    center: new THREE.Vector3(0, 22, 0).multiplyScalar(b.root.scale.y),
    dispose() {
      const materials = new Set<THREE.Material>()
      b.root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        ;(object.geometry as THREE.BufferGeometry).dispose()
        const material = object.material as THREE.Material | THREE.Material[]
        for (const entry of Array.isArray(material) ? material : [material]) materials.add(entry)
      })
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) {
          material.map?.dispose()
          material.alphaMap?.dispose()
        }
        material.dispose()
      }
    }
  }
}
