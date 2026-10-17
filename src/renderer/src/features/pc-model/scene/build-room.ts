/**
 * Diorama around the PC: an evening gaming corner, cut open on the front and
 * the right like an architect's model. The desk runs along the back wall with
 * the PC at its right end, glass towards the viewer; monitor, keyboard and
 * chair share one axis. Warm lamps and string lights answer the cool night
 * outside the window and the RGB of the PC.
 *
 * Same units and axes as the PC model: centimetres, x from the left wall to
 * the open right side, z from the back wall to the open front, the desk top
 * at the PC's feet (y = -2.2).
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  floorTexture,
  keyboardTexture,
  nightSkyTexture,
  posterTexture,
  random,
  rugTexture,
  wallpaperTexture,
  woodTexture
} from './textures'

/** A wall hides itself when the camera moves behind it. */
export interface Wall {
  group: THREE.Group
  /** A point of the inner face and the normal pointing into the room, in model units. */
  point: THREE.Vector3
  normal: THREE.Vector3
}

/** Follows the scene brightness, from 0 (lamps nearly off) to 1 (every lamp up). */
export type Dimmer = (level: number) => void

export interface Room {
  group: THREE.Group
  walls: Wall[]
  /** Lamp shades, bulbs, screen and window: the meshes the bloom pass keeps. */
  glowing: THREE.Mesh[]
  dimmers: Dimmer[]
  dispose(): void
}

type Vec = readonly [number, number, number]
type Faces = Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', THREE.Material>>

const DESK = -2.2
const FLOOR = -77
const BACK = -25
const LEFT = -150
const RIGHT = 85
const FRONT = 100
const TOP = 88
/** Seat axis: monitor, keyboard and chair are centred on it. */
const SEAT_X = -82
const UP = new THREE.Vector3(0, 1, 0)
const WARM = new THREE.Color(0xffb66e)
/** Linear colour of a 2700 K bulb seen through fabric or opal glass: amber, never white. */
const AMBER = new THREE.Color(1, 0.36, 0.08)

const paint = (color: number, roughness = 0.85, metalness = 0): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })

/** Leaf blade along +y, tapered, folded along the midrib and drooping towards its tip. */
function leafGeometry(length: number, width: number, heart: boolean): THREE.BufferGeometry {
  const rows = 8
  const cols = 4
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= rows; i++) {
    const u = i / rows
    const profile = heart
      ? Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7 * (1 - 0.25 * u)
      : Math.sin(Math.PI * u) ** 0.85
    const half = (width / 2) * Math.max(0.02, profile)
    for (let j = 0; j <= cols; j++) {
      const v = -1 + (2 * j) / cols
      positions.push(v * half, u * length, -Math.abs(v) * half * 0.35 - u * u * length * 0.22)
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j
      const b = a + cols + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

class RoomBuilder {
  readonly group = new THREE.Group()
  readonly glowing: THREE.Mesh[] = []
  readonly dimmers: Dimmer[] = []
  private readonly next = random(42)

  readonly wall = paint(0x434a56, 0.95)
  /** Cut edges of the walls, as on an architect's model. */
  readonly cut = paint(0xd8d0c2, 0.9)
  readonly skirting = paint(0x2b3039, 0.8)
  readonly steel = paint(0x18181b, 0.45, 0.6)
  readonly oak = new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0xc9a27e, roughness: 0.5 })
  readonly fabric = paint(0x363840, 0.95)
  readonly leaves = [paint(0x3d7238, 0.6), paint(0x2c5f33, 0.6), paint(0x4f8a42, 0.65)]
  readonly stem = paint(0x4a6630, 0.7)
  readonly soil = paint(0x2e2219, 1)

  constructor() {
    this.group.scale.setScalar(0.01)
    for (const leaf of this.leaves) leaf.side = THREE.DoubleSide
  }

  mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    at: Vec,
    parent: THREE.Object3D = this.group
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...at)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  box(size: Vec, material: THREE.Material, at: Vec, parent?: THREE.Object3D, radius = 0): THREE.Mesh {
    const geometry =
      radius > 0
        ? new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius)
        : new THREE.BoxGeometry(...size)
    return this.mesh(geometry, material, at, parent)
  }

  /** Wall slab: painted faces, light-coloured cut faces where the model is sliced open. */
  slab(size: Vec, at: Vec, parent: THREE.Object3D, cuts: Faces): THREE.Mesh {
    const faces = [cuts.px, cuts.nx, cuts.py, cuts.ny, cuts.pz, cuts.nz].map((face) => face ?? this.wall)
    return this.mesh(new THREE.BoxGeometry(...size), faces, at, parent)
  }

  cylinder(
    top: number,
    bottom: number,
    height: number,
    material: THREE.Material,
    at: Vec,
    parent?: THREE.Object3D
  ): THREE.Mesh {
    return this.mesh(new THREE.CylinderGeometry(top, bottom, height, 40), material, at, parent)
  }

  /** Self-lit surface (screen, shade, bulb) whose brightness follows the scene level. */
  glow(mesh: THREE.Mesh, color: THREE.Color, base: number, range: number): void {
    const material = mesh.material as THREE.MeshBasicMaterial
    mesh.castShadow = false
    this.glowing.push(mesh)
    this.dimmers.push((level) => material.color.copy(color).multiplyScalar(base + range * level))
  }

  /** Light whose intensity follows the scene level. */
  light<T extends THREE.Light>(light: T, base: number, range: number, at: Vec): T {
    light.position.set(...at)
    this.group.add(light)
    this.dimmers.push((level) => {
      light.intensity = base + range * level
    })
    return light
  }

  /** Ceramic pot with a rim and soil; returns the height of the soil. */
  pot(at: Vec, radius: number, height: number, material: THREE.Material): number {
    const [x, y, z] = at
    this.cylinder(radius, radius * 0.82, height, material, [x, y + height / 2, z])
    this.mesh(new THREE.TorusGeometry(radius - 0.3, 0.6, 8, 40), material, [
      x,
      y + height - 0.2,
      z
    ]).rotation.x = Math.PI / 2
    this.cylinder(radius - 0.6, radius - 0.6, 0.4, this.soil, [x, y + height - 1.2, z])
    return y + height - 1
  }

  /** Bush of leaves on stems rising from `base`, merged into a few meshes. */
  plant(base: THREE.Vector3, count: number, reach: number, leaf: { length: number; width: number }): void {
    const next = this.next
    const blades = this.leaves.map(() => [] as THREE.BufferGeometry[])
    const stems: THREE.BufferGeometry[] = []
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + next() * 0.6
      const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle))
      const tip = base
        .clone()
        .addScaledVector(outward, reach * (0.3 + next() * 0.6))
        .add(new THREE.Vector3(0, reach * (0.5 + next() * 0.7), 0))
      const middle = base
        .clone()
        .lerp(tip, 0.5)
        .add(new THREE.Vector3(0, reach * 0.25, 0))
      stems.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(base, middle, tip), 8, 0.3, 5))

      const direction = outward
        .clone()
        .add(new THREE.Vector3(0, 0.3 + next() * 0.5, 0))
        .normalize()
      const scale = 0.75 + next() * 0.4
      const blade = leafGeometry(leaf.length * scale, leaf.width * scale, true)
      const orientation = new THREE.Quaternion()
        .setFromUnitVectors(UP, direction)
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, (next() - 0.5) * 1.2))
      blade.applyMatrix4(new THREE.Matrix4().compose(tip, orientation, new THREE.Vector3(1, 1, 1)))
      blades[i % blades.length]!.push(blade)
    }
    blades.forEach((geometries, k) => this.merged(geometries, this.leaves[k]!))
    this.merged(stems, this.stem)
  }

  merged(
    geometries: THREE.BufferGeometry[],
    material: THREE.Material,
    parent?: THREE.Object3D
  ): THREE.Mesh | null {
    if (geometries.length === 0) return null
    const merged = mergeGeometries(geometries)
    for (const geometry of geometries) geometry.dispose()
    return merged ? this.mesh(merged, material, [0, 0, 0], parent) : null
  }
}

/* ---------------------------------- Shell --------------------------------- */

function buildShell(r: RoomBuilder): Wall[] {
  const width = RIGHT - LEFT
  const depth = FRONT - BACK
  const cx = (LEFT + RIGHT) / 2
  const cz = (FRONT + BACK) / 2
  const height = TOP - FLOOR

  // Model base, oak floor, wool rug under the chair.
  const base = r.box(
    [width + 8, 7, depth + 8],
    paint(0x1b1817, 0.7),
    [cx - 2, FLOOR - 4.7, cz - 2],
    undefined,
    1.5
  )
  base.castShadow = false
  const floor = new THREE.MeshStandardMaterial({
    map: floorTexture([3.5, 2]),
    color: 0xb9a189,
    roughness: 0.55
  })
  r.box([width, 1.2, depth], floor, [cx, FLOOR - 0.6, cz]).castShadow = false
  const rug = new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 })
  r.box([150, 0.6, 92], rug, [SEAT_X, FLOOR + 0.3, 52], undefined, 0.3).castShadow = false

  // Back wall: wood slat panel behind the monitor, a print above the PC, string lights.
  const back = new THREE.Group()
  r.group.add(back)
  r.slab([width + 4, height, 4], [cx - 2, (TOP + FLOOR) / 2, BACK - 2], back, { px: r.cut, py: r.cut })
  r.box([width, 7, 1.2], r.skirting, [cx, FLOOR + 3.5, BACK + 0.6], back)

  r.box([90, 66, 1.2], paint(0x141416, 1), [SEAT_X, 37, BACK + 0.6], back)
  const slats: THREE.BufferGeometry[] = []
  for (let i = 0; i < 17; i++) {
    const slat = new THREE.BoxGeometry(3, 64, 1.8)
    slat.translate(SEAT_X - 42 + i * 5.25, 37, BACK + 2.1)
    slats.push(slat)
  }
  r.merged(slats, paint(0xa77a52, 0.6), back)

  r.box([32, 24, 1.6], paint(0x111113, 0.5), [2, 66, BACK + 0.8], back, 0.3)
  r.mesh(
    new THREE.PlaneGeometry(28.5, 20.5),
    new THREE.MeshStandardMaterial({ map: posterTexture(), roughness: 0.8 }),
    [2, 66, BACK + 1.65],
    back
  )

  // String lights in three swags along the top of the wall.
  const hooks = [LEFT + 4, -78, -6, RIGHT - 6]
  const points: THREE.Vector3[] = []
  hooks.forEach((x, i) => {
    points.push(new THREE.Vector3(x, 83, BACK + 1.5))
    const nextHook = hooks[i + 1]
    if (nextHook !== undefined) points.push(new THREE.Vector3((x + nextHook) / 2, 75, BACK + 2.5))
  })
  const wire = new THREE.CatmullRomCurve3(points)
  r.mesh(new THREE.TubeGeometry(wire, 160, 0.16, 4), r.steel, [0, 0, 0], back).castShadow = false
  const bulbs: THREE.BufferGeometry[] = []
  for (let i = 1; i < 32; i++) {
    const at = wire.getPointAt(i / 32)
    const bulb = new THREE.SphereGeometry(0.85, 10, 8)
    bulb.translate(at.x, at.y - 1.1, at.z + 0.4)
    bulbs.push(bulb)
  }
  const string = r.merged(bulbs, new THREE.MeshBasicMaterial(), back)
  if (string) r.glow(string, WARM, 0.6, 1)
  for (const x of [-95, -5])
    r.light(new THREE.PointLight(0xffb36b, 0, 1.3, 2), 0.008, 0.045, [x, 76, BACK + 8])

  // Left wall around a window on the city.
  const left = new THREE.Group()
  r.group.add(left)
  const opening = { z0: 6, z1: 62, y0: 6, y1: 68 }
  const wallX = LEFT - 2
  const [sideH, sideY] = [opening.y1 - opening.y0, (opening.y0 + opening.y1) / 2]
  const [paneZ, paneMid] = [opening.z1 - opening.z0, (opening.z0 + opening.z1) / 2]
  const fullZ = FRONT - (BACK - 4)
  const midZ = (FRONT + BACK - 4) / 2
  r.slab([4, opening.y0 - FLOOR, fullZ], [wallX, (FLOOR + opening.y0) / 2, midZ], left, { pz: r.cut })
  r.slab([4, TOP - opening.y1, fullZ], [wallX, (opening.y1 + TOP) / 2, midZ], left, { pz: r.cut, py: r.cut })
  r.slab([4, sideH, opening.z0 - BACK + 4], [wallX, sideY, (BACK - 4 + opening.z0) / 2], left, {})
  r.slab([4, sideH, FRONT - opening.z1], [wallX, sideY, (opening.z1 + FRONT) / 2], left, { pz: r.cut })
  r.box([1.2, 7, depth], r.skirting, [LEFT + 0.6, FLOOR + 3.5, cz], left)

  const frame = paint(0xe6dfd2, 0.6)
  for (const [size, at] of [
    [
      [5, 3, paneZ + 6],
      [LEFT, opening.y0 - 1.5, paneMid]
    ],
    [
      [5, 3, paneZ + 6],
      [LEFT, opening.y1 + 1.5, paneMid]
    ],
    [
      [5, sideH, 3],
      [LEFT, sideY, opening.z0 - 1.5]
    ],
    [
      [5, sideH, 3],
      [LEFT, sideY, opening.z1 + 1.5]
    ],
    [
      [3, sideH, 2],
      [LEFT - 1, sideY, paneMid]
    ],
    [
      [3, 2, paneZ],
      [LEFT - 1, opening.y0 + sideH * 0.66, paneMid]
    ]
  ] as const) {
    r.box(size, frame, at, left)
  }
  const sillY = opening.y0 - 3.5
  r.box([12, 2, paneZ + 12], frame, [LEFT + 4.5, sillY, paneMid], left)
  const pane = r.mesh(
    new THREE.PlaneGeometry(paneZ, sideH),
    new THREE.MeshBasicMaterial({ map: nightSkyTexture() }),
    [LEFT - 2.5, sideY, paneMid],
    left
  )
  pane.rotation.y = Math.PI / 2
  r.glow(pane, new THREE.Color(1, 1, 1), 0.38, 0.4)

  // Candle on the sill.
  const jar = new THREE.MeshStandardMaterial({
    color: 0xb8742e,
    roughness: 0.2,
    transparent: true,
    opacity: 0.85
  })
  r.cylinder(2.8, 2.8, 6.5, jar, [LEFT + 5, sillY + 4.25, opening.z0 + 12], left).castShadow = false
  const flame = r.mesh(
    new THREE.ConeGeometry(0.55, 1.8, 10),
    new THREE.MeshBasicMaterial(),
    [LEFT + 5, sillY + 8.6, opening.z0 + 12],
    left
  )
  r.glow(flame, new THREE.Color(1, 0.72, 0.36), 1.4, 0.6)
  r.light(new THREE.PointLight(0xff9d4a, 0, 0.9, 2), 0.006, 0.012, [LEFT + 7, sillY + 10, opening.z0 + 12])

  // Long linen curtain beside the window, down to the floor.
  const drop = opening.y1 + 8 - FLOOR
  const curtain = new THREE.PlaneGeometry(18, drop, 36, 1)
  const position = curtain.getAttribute('position')
  for (let i = 0; i < position.count; i++) position.setZ(i, Math.sin(position.getX(i) * 1.2) * 1.3)
  curtain.computeVertexNormals()
  const linen = paint(0xcfc2aa, 0.95)
  linen.side = THREE.DoubleSide
  const drape = r.mesh(curtain, linen, [LEFT + 4, FLOOR + drop / 2, opening.z1 + 12], left)
  drape.rotation.y = Math.PI / 2
  drape.castShadow = false
  r.cylinder(0.6, 0.6, paneZ + 34, r.steel, [LEFT + 4, opening.y1 + 9, paneMid + 8], left).rotation.x =
    Math.PI / 2

  return [
    { group: back, point: new THREE.Vector3(0, 0, BACK), normal: new THREE.Vector3(0, 0, 1) },
    { group: left, point: new THREE.Vector3(LEFT, 0, 0), normal: new THREE.Vector3(1, 0, 0) }
  ]
}

/* ------------------------------ Desk and setup ----------------------------- */

function buildDesk(r: RoomBuilder): void {
  const x0 = -140
  const x1 = 32
  const z0 = BACK + 1
  const z1 = 48
  const thickness = 3.5
  r.box(
    [x1 - x0, thickness, z1 - z0],
    r.oak,
    [(x0 + x1) / 2, DESK - thickness / 2, (z0 + z1) / 2],
    undefined,
    0.5
  )

  // Black steel frame: two T-legs and a back rail.
  const under = DESK - thickness
  const legHeight = under - 3 - (FLOOR + 3)
  for (const x of [x0 + 10, x1 - 10]) {
    r.box([6, legHeight, 5], r.steel, [x, FLOOR + 3 + legHeight / 2, (z0 + z1) / 2])
    r.box([6, 3, z1 - z0 - 8], r.steel, [x, FLOOR + 1.5, (z0 + z1) / 2], undefined, 0.8)
    r.box([6, 3, z1 - z0 - 8], r.steel, [x, under - 1.5, (z0 + z1) / 2])
  }
  r.box([x1 - x0 - 20, 4, 2.5], r.steel, [(x0 + x1) / 2, under - 2, z0 + 6])

  // Monitor on its stand, with a warm light bar on top.
  const plastic = paint(0x141417, 0.5, 0.3)
  r.box([24, 1, 17], plastic, [SEAT_X, DESK + 0.5, -12], undefined, 0.4)
  r.box([4, 24, 2.5], plastic, [SEAT_X, DESK + 12, -18.5])
  r.box([20, 20, 3], plastic, [SEAT_X, 33, -18.5], undefined, 0.6)
  r.box([62.5, 37, 2.4], plastic, [SEAT_X, 33, -16], undefined, 0.5)
  const screen = r.mesh(
    new THREE.PlaneGeometry(60.5, 34),
    new THREE.MeshBasicMaterial({ map: wallpaperTexture() }),
    [SEAT_X, 33.4, -14.75]
  )
  r.glow(screen, new THREE.Color(1, 1, 1), 0.5, 0.25)
  r.box([44, 1.4, 2.4], plastic, [SEAT_X, 52.4, -15.6], undefined, 0.4)
  const lightBar = r.mesh(new THREE.PlaneGeometry(41, 1), new THREE.MeshBasicMaterial(), [
    SEAT_X,
    51.65,
    -15.4
  ])
  lightBar.rotation.x = Math.PI / 2
  r.glow(lightBar, WARM, 0.45, 0.9)
  const wash = r.light(new THREE.SpotLight(0xffc28a, 0, 1.2, 0.9, 0.7, 2), 0.02, 0.09, [SEAT_X, 51, -12])
  wash.target.position.set(SEAT_X, DESK, 18)
  r.group.add(wash.target)

  // Small pothos and a stack of books in the back-left corner.
  const soil = r.pot([-127, DESK, -13], 6, 10, paint(0xb5654a, 0.8))
  r.plant(new THREE.Vector3(-127, soil, -13), 11, 11, { length: 6.5, width: 5.5 })
  for (const [i, color, size] of [
    [0, 0x7d5a4a, [22, 3, 15]],
    [1, 0x3d5566, [20, 2.6, 14]],
    [2, 0xc9b48f, [19, 2.2, 13.5]]
  ] as const) {
    const book = r.box(size, paint(color, 0.8), [-110, DESK + 1.5 + i * 2.8, -12], undefined, 0.25)
    book.rotation.y = 0.08 * (i - 1)
  }

  // Desk mat, keyboard, mouse, mug.
  r.box([92, 0.3, 38], paint(0x2a2c31, 1), [SEAT_X + 4, DESK + 0.15, 25], undefined, 0.15)
  r.box([36, 2, 12.5], paint(0x1a1a1e, 0.6), [SEAT_X, DESK + 1.3, 23], undefined, 0.6)
  const keys = r.mesh(
    new THREE.PlaneGeometry(34.5, 11),
    new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.7 }),
    [SEAT_X, DESK + 2.32, 23]
  )
  keys.rotation.x = -Math.PI / 2
  const mouse = r.mesh(new THREE.SphereGeometry(1, 24, 16), paint(0x1b1b1f, 0.45), [
    SEAT_X + 30,
    DESK + 1.5,
    25
  ])
  mouse.scale.set(3.1, 1.7, 6)
  const ceramic = paint(0xe9e2d6, 0.35)
  r.cylinder(4, 3.7, 9, ceramic, [-38, DESK + 4.5, 32])
  r.cylinder(3.5, 3.5, 0.3, paint(0x2b1a10, 0.3), [-38, DESK + 8.2, 32])
  r.mesh(new THREE.TorusGeometry(2.4, 0.6, 10, 24), ceramic, [-34.2, DESK + 4.8, 32])

  // Mushroom lamp at the front-left corner of the desk.
  const brass = paint(0xb08d57, 0.35, 0.8)
  r.cylinder(5.5, 6, 1.2, brass, [-128, DESK + 0.6, 30])
  r.cylinder(0.9, 0.9, 18, brass, [-128, DESK + 10, 30])
  const dome = r.mesh(
    new THREE.SphereGeometry(11, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial(),
    [-128, DESK + 18.5, 30]
  )
  dome.scale.y = 0.72
  r.glow(dome, AMBER, 0.15, 0.6)
  r.light(new THREE.PointLight(0xffb978, 0, 1.6, 2), 0.012, 0.11, [-128, DESK + 17, 30])
}

function buildChair(r: RoomBuilder): void {
  const chair = new THREE.Group()
  chair.position.set(SEAT_X + 4, FLOOR, 72)
  chair.rotation.y = -0.18
  r.group.add(chair)
  for (let k = 0; k < 5; k++) {
    const angle = (k / 5) * Math.PI * 2
    const arm = r.box([26, 2.4, 4], r.steel, [Math.cos(angle) * 13, 5, Math.sin(angle) * 13], chair, 0.8)
    arm.rotation.y = -angle
    r.mesh(
      new THREE.SphereGeometry(2.4, 12, 10),
      r.steel,
      [Math.cos(angle) * 26, 2.4, Math.sin(angle) * 26],
      chair
    )
  }
  r.cylinder(2.2, 2.6, 38, r.steel, [0, 24, 0], chair)
  r.box([50, 7, 48], r.fabric, [0, 45, 0], chair, 3)
  r.box([46, 58, 7], r.fabric, [0, 79, 24], chair, 3).rotation.x = 0.12
  for (const x of [-25, 25]) {
    r.box([3, 18, 4], r.steel, [x, 55, 4], chair)
    r.box([5.5, 2.6, 24], r.fabric, [x, 64.5, 2], chair, 1)
  }
}

function buildCorner(r: RoomBuilder): void {
  // Tripod floor lamp with a fabric drum shade: the main warm light of the room.
  const lampX = 58
  const lampZ = 0
  const apex = new THREE.Vector3(lampX, 52, lampZ)
  const legs: THREE.BufferGeometry[] = []
  for (let k = 0; k < 3; k++) {
    const angle = Math.PI / 2 + (k * Math.PI * 2) / 3
    const foot = new THREE.Vector3(lampX + Math.cos(angle) * 22, FLOOR, lampZ + Math.sin(angle) * 22)
    legs.push(new THREE.TubeGeometry(new THREE.LineCurve3(foot, apex), 1, 1, 8))
  }
  r.merged(legs, paint(0x5c3f2a, 0.6))
  r.cylinder(1.2, 1.2, 6, r.steel, [lampX, apex.y + 2, lampZ])
  const shade = r.mesh(
    new THREE.CylinderGeometry(14, 16, 21, 48, 1, true),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    [lampX, 64, lampZ]
  )
  r.glow(shade, AMBER, 0.05, 0.58)
  const lamp = r.light(new THREE.PointLight(0xffad66, 0, 4, 2), 0.02, 0.75, [lampX, 62, lampZ])
  lamp.castShadow = true
  lamp.shadow.mapSize.set(1024, 1024)
  lamp.shadow.camera.near = 0.03
  lamp.shadow.camera.far = 4
  lamp.shadow.bias = -0.002
  lamp.shadow.normalBias = 0.02
  lamp.shadow.radius = 4

  // Monstera in a dark ceramic pot, in front of the lamp.
  const soil = r.pot([66, FLOOR, 24], 13, 26, paint(0x2a2b2f, 0.45))
  r.plant(new THREE.Vector3(66, soil, 24), 13, 34, { length: 21, width: 18 })
}

export function buildRoom(): Room {
  const r = new RoomBuilder()
  const walls = buildShell(r)
  buildDesk(r)
  buildChair(r)
  buildCorner(r)

  // Night through the window: cool and faint, the only light leaving window-shaped shadows.
  const moon = r.light(new THREE.DirectionalLight(0x8ea7e0, 0), 0.05, 0.45, [LEFT - 260, 120, 70])
  moon.target.position.set(-70, FLOOR, 40)
  r.group.add(moon.target)
  moon.castShadow = true
  moon.shadow.mapSize.set(2048, 2048)
  // The shadow camera works in world units (metres), not in the group's centimetres.
  Object.assign(moon.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 7 })
  moon.shadow.bias = -0.0004
  moon.shadow.normalBias = 0.015
  moon.shadow.radius = 3
  r.light(new THREE.HemisphereLight(0x3b4c78, 0x2a1d14, 0), 0.06, 0.4, [0, 100, 0])

  return {
    group: r.group,
    walls,
    glowing: r.glowing,
    dimmers: r.dimmers,
    dispose() {
      const materials = new Set<THREE.Material>()
      r.group.traverse((object) => {
        if (object instanceof THREE.PointLight || object instanceof THREE.DirectionalLight)
          object.shadow.dispose()
        if (!(object instanceof THREE.Mesh)) return
        ;(object.geometry as THREE.BufferGeometry).dispose()
        const material = object.material as THREE.Material | THREE.Material[]
        for (const entry of Array.isArray(material) ? material : [material]) materials.add(entry)
      })
      for (const material of materials) {
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) {
          material.map?.dispose()
        }
        material.dispose()
      }
    }
  }
}
