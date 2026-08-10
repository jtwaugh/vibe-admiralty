import * as THREE from 'three'
import type { ShipModel } from '../physics/masses'
import { halfBreadthAt } from '../hull/stations'
import type { ShipMaterials } from './materials'

/**
 * Carved and glazed work: the figurehead under the bowsprit and the stern
 * gallery over the counter. These are the cosmetics of SPEC §5, and they are
 * meant to be seen, so each option has its own shape rather than only its own
 * mass and price.
 */

function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.castShadow = true
  return mesh
}

/** A crouching lion, gilded: body, mane, head and forepaws. */
function lion(scale: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const body = part(new THREE.CapsuleGeometry(0.34 * scale, 1.1 * scale, 4, 8), material, 'Body')
  body.rotation.z = Math.PI / 2
  group.add(body)

  const mane = part(new THREE.SphereGeometry(0.46 * scale, 12, 10), material, 'Mane')
  mane.position.set(0.72 * scale, 0.12 * scale, 0)
  mane.scale.set(0.8, 1, 1)
  group.add(mane)

  const head = part(new THREE.SphereGeometry(0.28 * scale, 10, 8), material, 'Head')
  head.position.set(1.02 * scale, 0.14 * scale, 0)
  group.add(head)

  for (const side of [-1, 1]) {
    const paw = part(
      new THREE.CapsuleGeometry(0.11 * scale, 0.7 * scale, 3, 6),
      material,
      'Paw',
    )
    paw.rotation.z = Math.PI / 2 - 0.25
    paw.position.set(0.55 * scale, -0.32 * scale, side * 0.22 * scale)
    group.add(paw)
  }
  return group
}

/** Neptune: a standing figure with a trident laid along the stem. */
function neptune(scale: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const torso = part(
    new THREE.CapsuleGeometry(0.3 * scale, 1.2 * scale, 4, 8),
    material,
    'Torso',
  )
  torso.rotation.z = Math.PI / 2 - 0.35
  group.add(torso)

  const head = part(new THREE.SphereGeometry(0.27 * scale, 10, 8), material, 'Head')
  head.position.set(0.86 * scale, 0.36 * scale, 0)
  group.add(head)

  const beard = part(new THREE.ConeGeometry(0.2 * scale, 0.5 * scale, 8), material, 'Beard')
  beard.position.set(0.92 * scale, 0.05 * scale, 0)
  beard.rotation.z = Math.PI - 0.4
  group.add(beard)

  const shaft = part(
    new THREE.CylinderGeometry(0.06 * scale, 0.06 * scale, 2.2 * scale, 6),
    material,
    'Trident',
  )
  shaft.rotation.z = Math.PI / 2 - 0.3
  shaft.position.set(0.2 * scale, 0.1 * scale, 0.3 * scale)
  group.add(shaft)
  return group
}

/** The cheap option: a carved scroll where a figure would go. */
function billet(scale: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group()
  const scroll = part(
    new THREE.TorusGeometry(0.34 * scale, 0.12 * scale, 8, 14, Math.PI * 1.6),
    material,
    'Scroll',
  )
  scroll.rotation.y = Math.PI / 2
  scroll.position.set(0.5 * scale, 0.1 * scale, 0)
  group.add(scroll)

  const trail = part(
    new THREE.BoxGeometry(1.1 * scale, 0.16 * scale, 0.22 * scale),
    material,
    'Trailboard',
  )
  trail.position.set(-0.1 * scale, -0.22 * scale, 0)
  trail.rotation.z = 0.24
  group.add(trail)
  return group
}

export function buildFigurehead(
  model: ShipModel,
  materials: ShipMaterials,
): THREE.Object3D | null {
  const id = model.design.cosmetics.figureheadId
  const hull = model.hull
  const scale = Math.max(1, hull.params.beam / 9)
  const carve =
    id === 'lion' ? lion : id === 'neptune' ? neptune : id === 'none' ? billet : null
  if (!carve) return null

  const group = carve(scale, materials.gilding)
  group.name = 'Figurehead'
  const bow = hull.stations[hull.stations.length - 1]
  // Under the bowsprit, on the head knee: raked forward with the stem.
  group.position.set(bow.x + hull.length * 0.045, bow.railY - 1.5 * scale, 0)
  group.rotation.z = 0.34
  return group
}

/**
 * The stern: a band of glazed lights across the transom, and for the gallery
 * option a projecting balcony with quarter galleries either side, which is the
 * part you can see from a broadside.
 */
export function buildSternGallery(
  model: ShipModel,
  materials: ShipMaterials,
): THREE.Object3D {
  const hull = model.hull
  const stern = hull.stations[0]
  const rake = hull.length * 0.045
  const group = new THREE.Group()
  group.name = 'SternGallery'
  const glazed = model.design.cosmetics.sternGalleryId === 'gallery'

  const deckY = hull.weatherDeckY
  const lightY = deckY - 1.15
  const halfBeam = Math.max(0.3, halfBreadthAt(hull, 0, lightY))
  // The transom rakes aft as it rises, so the lights stand off it by the rake
  // at their own height.
  const faceX = stern.x - rake * ((lightY - hull.params.depthOfHold * 0.9) / (stern.railY - hull.params.depthOfHold * 0.9))

  const count = glazed ? 5 : 3
  const spacing = (halfBeam * 1.55) / count
  for (let i = 0; i < count; i++) {
    const z = (i - (count - 1) / 2) * spacing
    const light = part(
      new THREE.BoxGeometry(0.18, glazed ? 1.25 : 0.85, spacing * 0.62),
      materials.glass,
      `SternLight_${i}`,
    )
    light.position.set(faceX - 0.06, lightY, z)
    group.add(light)
  }

  if (!glazed) return group

  // A balcony across the counter, with a rail on it.
  const balcony = part(
    new THREE.BoxGeometry(0.9, 0.16, halfBeam * 1.75),
    materials.timber,
    'GalleryFloor',
  )
  balcony.position.set(faceX - 0.4, lightY - 0.78, 0)
  group.add(balcony)

  const rail = part(
    new THREE.BoxGeometry(0.16, 0.6, halfBeam * 1.75),
    materials.gilding,
    'GalleryRail',
  )
  rail.position.set(faceX - 0.8, lightY - 0.45, 0)
  group.add(rail)

  // Quarter galleries: the little glazed bays on each quarter, which are what
  // the broadside camera actually sees of the stern work.
  const quarterU = 0.055
  const quarterX = (quarterU - 0.5) * hull.length
  const quarterY = deckY - 1.15
  const bayHeight = 1.5
  const bayLength = hull.length * 0.045
  const quarterZ = halfBreadthAt(hull, quarterU, quarterY)
  for (const side of [-1, 1]) {
    const bay = part(
      new THREE.BoxGeometry(bayLength, bayHeight, 0.34),
      materials.glass,
      `QuarterGallery_${side > 0 ? 'starboard' : 'port'}`,
    )
    bay.position.set(quarterX, quarterY, side * (quarterZ + 0.1))
    group.add(bay)

    for (const y of [quarterY + bayHeight / 2 + 0.11, quarterY - bayHeight / 2 - 0.09]) {
      const moulding = part(
        new THREE.BoxGeometry(bayLength * 1.12, 0.22, 0.42),
        materials.gilding,
        'QuarterMoulding',
      )
      moulding.position.set(quarterX, y, side * (quarterZ + 0.08))
      group.add(moulding)
    }
  }
  return group
}

/** The rudder, hung on the sternpost under the counter. */
export function buildRudder(model: ShipModel, materials: ShipMaterials): THREE.Mesh {
  const hull = model.hull
  const stern = hull.stations[0]
  const chord = hull.length * 0.036
  const top = hull.decks[0].y + 0.6
  const bottom = 0.15
  const height = top - bottom
  const rudder = part(
    new THREE.BoxGeometry(chord, height, 0.26),
    materials.underwater,
    'Rudder',
  )
  rudder.position.set(stern.x - chord * 0.4, bottom + height / 2, 0)
  return rudder
}
