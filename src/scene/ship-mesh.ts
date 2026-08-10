import * as THREE from 'three'
import { findGun } from '../data'
import { MeshBuilder, loftHull } from '../hull/loft'
import type { MeshData } from '../hull/loft'
import { deckYAtU, halfBreadthAt } from '../hull/stations'
import type { ShipModel } from '../physics/masses'
import { createShipMaterials } from './materials'
import type { ShipMaterials } from './materials'

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

function buildGun(gunId: string, materials: ShipMaterials): THREE.Group | null {
  const gun = findGun(gunId)
  if (!gun) return null
  const group = new THREE.Group()

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(gun.boreM * 0.72, gun.boreM * 1.05, gun.barrelLengthM, 12),
    materials.iron,
  )
  // Cylinders are built along y; lay this one along +z so it points outboard.
  barrel.rotation.x = Math.PI / 2
  barrel.position.z = gun.barrelLengthM / 2
  barrel.castShadow = true
  group.add(barrel)

  const carriage = new THREE.Mesh(
    new THREE.BoxGeometry(gun.boreM * 6, gun.boreM * 3.2, gun.barrelLengthM * 0.6),
    materials.timber,
  )
  carriage.position.set(0, -gun.boreM * 2.6, gun.barrelLengthM * 0.1)
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
      if (sail.tier === 'jib' || sail.tier === 'spanker') continue
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

    group.add(mast)
  }

  // Bowsprit, steeved up over the head.
  const bowsprit = mesh(
    spar(beam * 1.5, beam * 0.038, beam * 0.018),
    materials.timber,
    'Bowsprit',
  )
  bowsprit.rotation.z = -Math.PI / 2 + 0.42
  bowsprit.position.set(
    model.hull.length * 0.46,
    deckYAtU(model.hull, model.hull.weatherDeckY, 0.96),
    0,
  )
  group.add(bowsprit)

  return group
}

function buildGuns(model: ShipModel, materials: ShipMaterials): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Guns'
  for (const socket of model.sockets.mounts) {
    const config = model.design.mounts[socket.id]
    if (!config?.gunId || socket.kind === 'swivel') continue
    const mount = new THREE.Group()
    mount.name = NODE_NAMES.mount(socket.id)
    for (const side of ['starboard', 'port'] as const) {
      const count = Math.min(side === 'port' ? config.port : config.starboard, socket.maxPerSide)
      for (let i = 0; i < count; i++) {
        const position = socket.positions[i]
        if (!position) continue
        const gun = buildGun(config.gunId, materials)
        if (!gun) continue
        gun.name = NODE_NAMES.gunport(socket.deckIndex, i) + `_${side}`
        gun.position.set(position.x, position.y, side === 'port' ? -position.z : position.z)
        if (side === 'port') gun.rotation.y = Math.PI
        mount.add(gun)
      }
    }
    if (mount.children.length > 0) group.add(mount)
  }
  return group
}

function buildRudder(model: ShipModel, materials: ShipMaterials): THREE.Mesh {
  const hull = model.hull
  const stern = hull.stations[0]
  // The blade runs from the heel of the keel up to the counter, hung close
  // against the sternpost rather than standing off it.
  const top = hull.weatherDeckY - 1.2
  const height = top - stern.keelY
  const chord = hull.length * 0.032
  const rudder = mesh(
    new THREE.BoxGeometry(chord, height, 0.22),
    materials.timber,
    NODE_NAMES.rudder,
  )
  rudder.position.set(stern.x - chord * 0.42, stern.keelY + height / 2, 0)
  return rudder
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
  const thickness = 0.38
  const steps = 12
  const b = new MeshBuilder()

  const rows: number[][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = bow.keelY + t * (bow.railY + 0.5 - bow.keelY)
    // Quadratic sweep: nearly vertical at the forefoot, well raked at the head.
    const x = bow.x + rake * t * t
    rows.push([
      b.vertex(x, y, -thickness / 2, t, 0),
      b.vertex(x, y, thickness / 2, t, 1),
    ])
  }
  for (let i = 0; i < steps; i++) {
    b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0])
    b.quad(rows[i + 1][0], rows[i + 1][1], rows[i][1], rows[i][0])
  }
  return mesh(toBufferGeometry(b.finish()), materials.timber, 'Stem')
}

/** The transom: a raked panel closing the stern above the counter. */
function buildTransom(model: ShipModel, materials: ShipMaterials): THREE.Mesh {
  const hull = model.hull
  const stern = hull.stations[0]
  const rake = hull.length * 0.045
  const bottom = hull.params.depthOfHold * 0.9
  const top = stern.railY
  const b = new MeshBuilder()
  const steps = 6
  const rows: number[][] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = bottom + t * (top - bottom)
    const half = Math.max(0.2, halfBreadthAt(hull, 0, y))
    rows.push([
      b.vertex(stern.x - rake * t, y, -half, 0, t),
      b.vertex(stern.x - rake * t, y, half, 1, t),
    ])
  }
  for (let i = 0; i < steps; i++) {
    b.quad(rows[i + 1][0], rows[i + 1][1], rows[i][1], rows[i][0])
  }
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
      const bowspritTip = hull.length * 0.46 + hull.params.beam * 1.36
      const bowspritY = deckYAtU(hull, hull.weatherDeckY, 0.96) + hull.params.beam * 0.6
      points.push(mast.x, hounds, 0, bowspritTip, bowspritY, 0)
      points.push(mast.x, upper, 0, bowspritTip, bowspritY, 0)
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

export type ShipMesh = {
  group: THREE.Group
  materials: ShipMaterials
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

  group.add(hullGroup)
  group.add(buildRudder(model, materials))
  group.add(buildMasts(model, materials))
  group.add(buildGuns(model, materials))
  group.add(buildRigging(model, materials.rigging))

  return {
    group,
    materials,
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
