import * as THREE from 'three'
import { findGun } from '../data'
import { MeshBuilder, loftHull, paintV } from '../hull/loft'
import type { MeshData } from '../hull/loft'
import { gunOriginZ } from '../hull/sockets'
import { deckYAtU, halfBreadthAt } from '../hull/stations'
import type { ShipModel } from '../physics/masses'
import { buildFigurehead, buildRudder, buildSternGallery } from './fittings'
import { createShipMaterials } from './materials'
import type { ShipMaterials } from './materials'
import { buildSailGeometry } from './sails'
import type { SailPoint } from '../physics/sailplan'

/**
 * Node names are part of the export contract (SPEC §8): a future engine drives
 * animation by looking these up, so they must not drift.
 */
export const NODE_NAMES = {
  hull: 'Hull',
  rudder: 'Rudder',
  mast: (index: number) => `Mast_${index + 1}`,
  yard: (tier: string) => `Yard_${tier}`,
  sail: (mast: string, tier: string) => `Sail_${mast}_${tier}`,
  gunport: (deck: number, index: number) => `Gunport_${deck}_${index}`,
  mount: (socketId: string) => `Mount_${socketId}`,
}

function toBufferGeometry(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2))
  geometry.setIndex(data.indices)
  return geometry
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
  const m = new THREE.Mesh(geometry, material)
  m.name = name
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** A tapered spar running along +y, centred on the origin of its parent. */
function spar(length: number, radiusBottom: number, radiusTop: number) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 10)
  geometry.translate(0, length / 2, 0)
  return geometry
}

/**
 * One mounted gun, breech at the origin, bore along +z. Carriage guns get a
 * truck carriage under them; a swivel gets a yoke on a pintle instead.
 */
function buildGun(gunId: string, materials: ShipMaterials): THREE.Group | null {
  const gun = findGun(gunId)
  if (!gun) return null
  const group = new THREE.Group()
  const length = gun.barrelLengthM

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(gun.boreM * 0.78, gun.boreM * 1.3, length, 12),
    materials.iron,
  )
  // Cylinders are built along y; lay this one along +z so it points outboard.
  barrel.rotation.x = Math.PI / 2
  barrel.position.z = length / 2
  barrel.castShadow = true
  group.add(barrel)

  // The cascabel knob at the breech, which is what you see from inboard.
  const breech = new THREE.Mesh(
    new THREE.SphereGeometry(gun.boreM * 0.62, 8, 6),
    materials.iron,
  )
  breech.position.z = -gun.boreM * 0.5
  group.add(breech)

  if (gun.pattern === 'swivel') {
    const yoke = new THREE.Mesh(
      new THREE.CylinderGeometry(gun.boreM * 0.5, gun.boreM * 0.7, 0.5, 6),
      materials.iron,
    )
    yoke.position.set(0, -0.3, length * 0.4)
    group.add(yoke)
    return group
  }

  const carriage = new THREE.Mesh(
    new THREE.BoxGeometry(gun.boreM * 5.4, gun.boreM * 3.4, length * 0.52),
    materials.timber,
  )
  carriage.position.set(0, -gun.boreM * 2.9, length * 0.24)
  carriage.castShadow = true
  group.add(carriage)

  return group
}

function buildMasts(model: ShipModel, materials: ShipMaterials): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Masts'
  const beam = model.hull.params.beam

  for (const socket of model.sockets.masts) {
    const mast = new THREE.Group()
    mast.name = NODE_NAMES.mast(socket.index)
    mast.position.set(socket.x, socket.stepY, 0)

    const total = socket.truckY - socket.stepY
    // Lower mast, topmast and topgallant, each thinner than the one below.
    const segments: [number, number, number][] = [
      [total * 0.46, beam * 0.045, beam * 0.033],
      [total * 0.32, beam * 0.031, beam * 0.021],
      [total * 0.22, beam * 0.02, beam * 0.011],
    ]
    let y = 0
    segments.forEach(([length, rBottom, rTop], i) => {
      const segment = mesh(spar(length, rBottom, rTop), materials.timber, `MastSegment_${i}`)
      segment.position.y = y
      mast.add(segment)
      if (i < 2) {
        const top = mesh(
          new THREE.BoxGeometry(beam * 0.18, 0.14, beam * 0.34 * (i === 0 ? 1 : 0.7)),
          materials.timber,
          `Top_${i}`,
        )
        top.position.y = y + length
        mast.add(top)
      }
      y += length
    })

    for (const sail of model.sails.filter((s) => s.mastIndex === socket.index)) {
      const state = model.design.rig.sails[sail.id] ?? 'furled'
      if (sail.tier === 'jib' || sail.tier === 'spanker') {
        if (sail.tier === 'spanker') {
          // Boom and gaff, which the spanker is laced to along both edges.
          const corners = sail.corners.map((c) => ({ x: c.x - socket.x, y: c.y }))
          const spars: [SailPoint, SailPoint, string][] = [
            [corners[1], corners[2], 'Boom_spanker'],
            [corners[0], corners[3], 'Gaff_spanker'],
          ]
          for (const [a, b, name] of spars) {
            const length = Math.hypot(b.x - a.x, b.y - a.y)
            const boom = mesh(
              spar(length, beam * 0.013, beam * 0.009),
              materials.timber,
              name,
            )
            boom.rotation.z = Math.PI / 2 + Math.atan2(b.y - a.y, b.x - a.x)
            boom.position.set(a.x, a.y - socket.stepY, 0)
            mast.add(boom)
          }
        }
      } else {
        const yard = mesh(
          spar(sail.yardHalfSpan * 2, beam * 0.014, beam * 0.007),
          materials.timber,
          NODE_NAMES.yard(sail.tier),
        )
        // Spars are built along +y; roll this one to lie athwartships.
        yard.rotation.x = Math.PI / 2
        yard.position.set(0, sail.yardY - socket.stepY, -sail.yardHalfSpan)
        mast.add(yard)
      }

      const shape = buildSailGeometry(sail, socket.x, socket.stepY, state)
      const cloth = mesh(
        shape.geometry,
        state === 'set' ? materials.canvas : materials.furledCanvas,
        NODE_NAMES.sail(sail.mastLabel, sail.tier),
      )
      cloth.position.copy(shape.position)
      mast.add(cloth)
    }

    group.add(mast)
  }

  // Bowsprit, steeved up over the head, from the socket that also anchors the
  // headsails and the fore stays.
  const head = model.sockets.bowsprit
  const length = Math.hypot(head.tipX - head.rootX, head.tipY - head.rootY)
  const bowsprit = mesh(
    spar(length, beam * 0.038, beam * 0.018),
    materials.timber,
    'Bowsprit',
  )
  bowsprit.rotation.z = -Math.PI / 2 + Math.atan2(head.tipY - head.rootY, head.tipX - head.rootX)
  bowsprit.position.set(head.rootX, head.rootY, 0)
  group.add(bowsprit)

  return group
}

function buildGuns(model: ShipModel, materials: ShipMaterials): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Guns'
  const halfLength = model.hull.length / 2
  for (const socket of model.sockets.mounts) {
    const config = model.design.mounts[socket.id]
    if (!config?.gunId) continue
    const gun = findGun(config.gunId)
    if (!gun) continue
    const mount = new THREE.Group()
    mount.name = NODE_NAMES.mount(socket.id)
    for (const side of ['starboard', 'port'] as const) {
      const count = Math.min(side === 'port' ? config.port : config.starboard, socket.maxPerSide)
      const sign = side === 'port' ? -1 : 1
      for (let i = 0; i < count; i++) {
        const position = socket.positions[i]
        if (!position) continue
        const piece = buildGun(config.gunId, materials)
        if (!piece) continue
        piece.name = NODE_NAMES.gunport(socket.deckIndex, i) + `_${side}`
        if (socket.kind === 'chaser') {
          // Chasers fire over the bow or out of the stern, not over the side.
          const forward = socket.id === 'bow-chaser'
          const muzzleX = (forward ? 1 : -1) * (halfLength + 0.2)
          piece.position.set(
            muzzleX - (forward ? 1 : -1) * gun.barrelLengthM,
            position.y,
            sign * Math.min(position.z * 0.45, 1.6),
          )
          piece.rotation.y = forward ? Math.PI / 2 : -Math.PI / 2
        } else {
          const z =
            socket.kind === 'swivel'
              ? position.z
              : gunOriginZ(position.z, gun.barrelLengthM)
          piece.position.set(position.x, position.y, sign * z)
          if (side === 'port') piece.rotation.y = Math.PI
        }
        mount.add(piece)
      }
    }
    if (mount.children.length > 0) group.add(mount)
  }
  return group
}

/**
 * The stem and the knee of the head: a raked cutwater carried up past the rail.
 * The stations stay planar so the hydrostatics are untouched; this is joinery
 * added on the outside of them.
 */
function buildStem(model: ShipModel, materials: ShipMaterials): THREE.Mesh {
  const hull = model.hull
  const bow = hull.stations[hull.stations.length - 1]
  const rake = hull.length * 0.075
  const thickness = 0.42
  const siding = 0.62
  const steps = 12
  const b = new MeshBuilder()

  // A swept box, not a ribbon: two coincident faces would cancel each other's
  // vertex normals and the stem would render unlit and invisible.
  const rings: number[][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = bow.keelY + t * (bow.railY + 0.5 - bow.keelY)
    // Quadratic sweep: nearly vertical at the forefoot, well raked at the head.
    const x = bow.x + rake * t * t
    const half = thickness / 2
    rings.push([
      b.vertex(x, y, -half, t, 0),
      b.vertex(x, y, half, t, 0.25),
      b.vertex(x - siding, y, half, t, 0.5),
      b.vertex(x - siding, y, -half, t, 0.75),
    ])
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < 4; j++) {
      const k = (j + 1) % 4
      b.quad(rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j])
    }
  }
  return mesh(toBufferGeometry(b.finish()), materials.timber, 'Stem')
}

/**
 * The transom: a raked panel closing the stern above the counter. Its texture
 * coordinates sample the paint at the sternmost station, so the strakes carry
 * round the stern instead of the panel picking up whatever is at u = 0..1.
 */
function buildTransom(model: ShipModel, materials: ShipMaterials): THREE.Mesh {
  const hull = model.hull
  const stern = hull.stations[0]
  const rake = hull.length * 0.045
  const bottom = hull.params.depthOfHold * 0.9
  const top = stern.railY
  const b = new MeshBuilder()
  const steps = 6
  const face: number[][] = []
  const root: number[][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = bottom + t * (top - bottom)
    const half = Math.max(0.2, halfBreadthAt(hull, 0, y))
    const v = paintV(hull, 0, y)
    // The counter is a short solid, not a fin: the raked face aft and the
    // hull's own stern ring forward, with quarters joining them.
    face.push([
      b.vertex(stern.x - rake * t, y, -half * 0.94, 0.01, v),
      b.vertex(stern.x - rake * t, y, half * 0.94, 0.01, v),
    ])
    root.push([
      b.vertex(stern.x + 0.1, y, -half, 0.03, v),
      b.vertex(stern.x + 0.1, y, half, 0.03, v),
    ])
  }
  for (let i = 0; i < steps; i++) {
    b.quad(face[i + 1][0], face[i + 1][1], face[i][1], face[i][0])
    b.quad(root[i][0], face[i][0], face[i + 1][0], root[i + 1][0])
    b.quad(root[i][1], root[i + 1][1], face[i + 1][1], face[i][1])
  }
  // Cap the top of the counter so the deck does not look open from astern.
  b.quad(face[steps][0], face[steps][1], root[steps][1], root[steps][0])
  return mesh(toBufferGeometry(b.finish()), materials.hull, 'Transom')
}

/** Standing rigging: shrouds down to the channels, and fore-and-aft stays. */
function buildRigging(model: ShipModel, material: THREE.Material): THREE.LineSegments {
  const hull = model.hull
  const points: number[] = []
  const masts = model.sockets.masts

  masts.forEach((mast, index) => {
    const u = mast.x / hull.length + 0.5
    const channelY = deckYAtU(hull, hull.weatherDeckY, u) - 0.5
    const channelZ = halfBreadthAt(hull, u, channelY) + 0.55
    const hounds = mast.deckY + (mast.truckY - mast.deckY) * 0.45
    const upper = mast.deckY + (mast.truckY - mast.deckY) * 0.76

    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const spread = hull.length * 0.035 * (i / 4 - 0.5)
        points.push(mast.x, hounds, 0, mast.x + spread, channelY, side * channelZ)
      }
      for (let i = 0; i < 3; i++) {
        const spread = hull.length * 0.02 * (i / 2 - 0.5)
        points.push(mast.x, upper, 0, mast.x + spread, hounds, side * channelZ * 0.75)
      }
    }

    // Forestays run to the next mast forward, or out to the bowsprit end.
    const ahead = masts[index + 1]
    if (ahead) {
      points.push(mast.x, hounds, 0, ahead.x, ahead.deckY + 1.2, 0)
      points.push(mast.x, upper, 0, ahead.x, ahead.deckY + (ahead.truckY - ahead.deckY) * 0.45, 0)
    } else {
      const { tipX, tipY } = model.sockets.bowsprit
      points.push(mast.x, hounds, 0, tipX, tipY, 0)
      points.push(mast.x, upper, 0, tipX, tipY, 0)
    }
    // Backstays to the rail abaft the mast.
    for (const side of [-1, 1]) {
      points.push(mast.x, upper, 0, mast.x - hull.length * 0.12, channelY, side * channelZ * 0.9)
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  const lines = new THREE.LineSegments(geometry, material)
  lines.name = 'Rigging'
  return lines
}

/**
 * Clickable mount markers: a ring standing proud of the shell at each socket,
 * built from the socket positions the hull generator emits, so they follow the
 * hull when a slider moves it (SPEC §3). These are real geometry and the viewer
 * raycasts against them.
 */
/** Shared, never disposed: one invisible material behind every marker disc. */
const HIT_MATERIAL = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })

function buildMarkers(model: ShipModel, materials: ShipMaterials): {
  group: THREE.Group
  targets: THREE.Mesh[]
} {
  const group = new THREE.Group()
  group.name = 'Markers'
  const targets: THREE.Mesh[] = []
  const radius = Math.max(0.5, model.hull.params.beam * 0.055)

  for (const socket of model.sockets.mounts) {
    // One marker on each side, so a mount stays reachable whichever way the
    // orbit camera is pointing. Both open the same mount.
    for (const side of [1, -1]) {
      const marker = new THREE.Group()
      marker.name = `Marker_${socket.id}${side > 0 ? '' : '_port'}`
      marker.position.set(socket.marker.x, socket.marker.y, side * (socket.marker.z + 0.25))
      if (side < 0) marker.rotation.y = Math.PI

      // Both the ring and its hit disc are built in XY, so they already face
      // outboard where the camera sees them square on.
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, radius * 0.16, 8, 20),
        materials.marker,
      )
      ring.renderOrder = 2
      marker.add(ring)

      // An invisible disc makes the whole marker easy to hit, not just the wire.
      const hit = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.15, 16), HIT_MATERIAL)
      hit.userData.socketId = socket.id
      marker.add(hit)
      targets.push(hit)

      group.add(marker)
    }
  }
  return { group, targets }
}

export type ShipMesh = {
  group: THREE.Group
  materials: ShipMaterials
  /** Raycast targets for the mount markers; userData.socketId identifies them. */
  markerTargets: THREE.Mesh[]
  markers: THREE.Group
  dispose(): void
}

/**
 * Build the whole ship as a named node hierarchy in ship-local coordinates.
 * The caller positions the group so the load waterline sits at world y = 0.
 */
export function buildShipMesh(model: ShipModel, waterlineY: number): ShipMesh {
  const materials = createShipMaterials({ hull: model.hull, model, waterlineY })
  const lofted = loftHull(model.hull)

  const group = new THREE.Group()
  group.name = 'Ship'

  const hullGroup = new THREE.Group()
  hullGroup.name = NODE_NAMES.hull
  const shellGeometry = toBufferGeometry(lofted.shell)
  hullGroup.add(mesh(shellGeometry, materials.hull, 'Shell'))
  hullGroup.add(mesh(toBufferGeometry(lofted.deck), materials.deck, 'Deck'))
  hullGroup.add(mesh(toBufferGeometry(lofted.bulwark), materials.bulwark, 'Bulwark'))

  // The keel, a plain timber batten under the whole length of the bottom.
  const keel = mesh(
    new THREE.BoxGeometry(model.hull.length * 0.86, 0.42, 0.34),
    materials.timber,
    'Keel',
  )
  keel.position.set(0, -0.1, 0)
  hullGroup.add(keel)

  hullGroup.add(buildStem(model, materials))
  hullGroup.add(buildTransom(model, materials))
  hullGroup.add(buildSternGallery(model, materials))
  const figurehead = buildFigurehead(model, materials)
  if (figurehead) hullGroup.add(figurehead)

  group.add(hullGroup)
  group.add(buildRudder(model, materials))
  group.add(buildMasts(model, materials))
  group.add(buildGuns(model, materials))
  group.add(buildRigging(model, materials.rigging))

  const markers = buildMarkers(model, materials)
  markers.group.visible = false
  group.add(markers.group)

  return {
    group,
    materials,
    markerTargets: markers.targets,
    markers: markers.group,
    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
      })
      materials.dispose()
    },
  }
}

/** Half breadth at the rail amidships, handy for framing the camera. */
export function railHalfBeam(model: ShipModel): number {
  return halfBreadthAt(model.hull, 0.5, model.hull.railY)
}
