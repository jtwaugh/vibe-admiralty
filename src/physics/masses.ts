import {
  cosmeticsFile,
  findGun,
  getPreset,
  getSpecies,
  getZone,
  sailsFile,
  timberFile,
  timberZones,
} from '../data'
import type { HullPreset, TimberZoneId } from '../data/schemas'
import { hullZoneSurfaces, railLength } from '../hull/areas'
import type { Hull } from '../hull/stations'
import { buildHull } from '../hull/stations'
import type { MountSocket, Sockets } from '../hull/sockets'
import { buildSockets, gunCentreOfMassZ } from '../hull/sockets'
import type { Design } from '../export/schema'
import type { Vec3 } from './hydrostatics'
import { buildSailPlan, totalSailArea } from './sailplan'
import type { SailInstance } from './sailplan'

export type MassItem = {
  label: string
  group: 'structure' | 'guns' | 'rig' | 'ballast' | 'stores' | 'crew' | 'fittings'
  massKg: number
  position: Vec3
}

export type MassSummary = {
  items: MassItem[]
  totalKg: number
  centreOfGravity: Vec3
  structureKg: number
  gunsKg: number
  rigKg: number
  ballastKg: number
  storesKg: number
  crewKg: number
  fittingsKg: number
}

/** Mass of one member of the ship's company with kit, kilograms. */
const CREW_MASS_KG = 82

export function combineMasses(items: MassItem[]): MassSummary {
  let total = 0
  let mx = 0
  let my = 0
  let mz = 0
  const byGroup: Record<MassItem['group'], number> = {
    structure: 0,
    guns: 0,
    rig: 0,
    ballast: 0,
    stores: 0,
    crew: 0,
    fittings: 0,
  }
  for (const item of items) {
    total += item.massKg
    mx += item.massKg * item.position.x
    my += item.massKg * item.position.y
    mz += item.massKg * item.position.z
    byGroup[item.group] += item.massKg
  }
  const centreOfGravity =
    total > 0 ? { x: mx / total, y: my / total, z: mz / total } : { x: 0, y: 0, z: 0 }
  return {
    items,
    totalKg: total,
    centreOfGravity,
    structureKg: byGroup.structure,
    gunsKg: byGroup.guns,
    rigKg: byGroup.rig,
    ballastKg: byGroup.ballast,
    storesKg: byGroup.stores,
    crewKg: byGroup.crew,
    fittingsKg: byGroup.fittings,
  }
}

/** Everything derived from a design that both the mass model and the UI need. */
export type ShipModel = {
  design: Design
  preset: HullPreset
  hull: Hull
  sockets: Sockets
  sails: SailInstance[]
  sailAreaM2: number
  masses: MassSummary
  /** Wetted surface eligible for copper sheathing. */
  wettedAreaM2: number
  gunCrew: number
  crewEstimate: number
}

function timberMasses(hull: Hull, design: Design): MassItem[] {
  const species = getSpecies(design.timber.speciesId)
  const surfaces = hullZoneSurfaces(hull)
  const items: MassItem[] = []
  for (const zone of timberZones) {
    const step = design.timber.zones[zone.id] ?? 'standard'
    const definition = getZone(zone.id)
    const thickness = definition.thicknessM[step]
    const surface = surfaces[zone.id as TimberZoneId]
    const massKg =
      surface.areaM2 * thickness * species.density * 1000 * definition.structureFactor
    items.push({
      label: zone.name,
      group: 'structure',
      massKg,
      position: { x: surface.centroid.x, y: surface.centroid.y, z: 0 },
    })
  }
  if (design.timber.nettings) {
    items.push({
      label: 'Hammock nettings',
      group: 'fittings',
      massKg: railLength(hull) * timberFile.nettings.massKgPerMetre,
      position: { x: 0, y: hull.railY + 0.4, z: 0 },
    })
  }
  return items
}

export function mountGunMasses(sockets: Sockets, design: Design): MassItem[] {
  const items: MassItem[] = []
  for (const socket of sockets.mounts) {
    const config = design.mounts[socket.id]
    if (!config || !config.gunId) continue
    const gun = findGun(config.gunId)
    if (!gun) continue
    for (const side of ['starboard', 'port'] as const) {
      const count = Math.min(side === 'port' ? config.port : config.starboard, socket.maxPerSide)
      for (let i = 0; i < count; i++) {
        const p = socket.positions[i]
        if (!p) continue
        // Swivels are clamped on the rail; carriage guns stand inboard of their
        // ports by however much barrel they have.
        const z =
          socket.kind === 'swivel' ? p.z : gunCentreOfMassZ(p.z, gun.barrelLengthM)
        items.push({
          label: `${gun.name} (${side})`,
          group: 'guns',
          massKg: gun.massKg,
          position: { x: p.x, y: p.y, z: side === 'port' ? -z : z },
        })
      }
    }
  }
  return items
}

/** Guns are placed outboard first, so counts spread along the battery span. */
export function gunCountsForSocket(socket: MountSocket, design: Design) {
  const config = design.mounts[socket.id]
  if (!config || !config.gunId) return { gunId: null, port: 0, starboard: 0 }
  return {
    gunId: config.gunId,
    port: Math.min(config.port, socket.maxPerSide),
    starboard: Math.min(config.starboard, socket.maxPerSide),
  }
}

export function buildShipModel(design: Design): ShipModel {
  const preset = getPreset(design.presetId)
  const hull = buildHull(design.hull)
  const sockets = buildSockets(hull, preset)
  const sails = buildSailPlan(hull, sockets, design.rig.sailPlanId)
  const sailAreaM2 = totalSailArea(sails)

  const items: MassItem[] = timberMasses(hull, design)

  // Rig: masts, yards, standing and running rigging, and the canvas itself.
  for (const mast of sockets.masts) {
    const mastSails = sails.filter((s) => s.mastIndex === mast.index)
    const area = totalSailArea(mastSails)
    items.push({
      label: `${mast.label} and rigging`,
      group: 'rig',
      massKg: area * sailsFile.rigMassKgPerSquareMetre,
      position: { x: mast.x, y: mast.deckY + 0.3 * (mast.truckY - mast.deckY), z: 0 },
    })
  }

  items.push(...mountGunMasses(sockets, design))

  const surfaces = hullZoneSurfaces(hull)
  const wettedAreaM2 = surfaces.bottom.areaM2 + surfaces.wales.areaM2
  if (design.cosmetics.copperSheathing) {
    items.push({
      label: 'Copper sheathing',
      group: 'fittings',
      massKg: wettedAreaM2 * timberFile.copperSheathing.massKgPerSquareMetre,
      position: { x: surfaces.bottom.centroid.x, y: surfaces.bottom.centroid.y, z: 0 },
    })
  }

  const figurehead = cosmeticsFile.figureheads.find((f) => f.id === design.cosmetics.figureheadId)
  if (figurehead) {
    items.push({
      label: figurehead.name,
      group: 'fittings',
      massKg: figurehead.massKg,
      position: { x: 0.47 * hull.length, y: hull.weatherDeckY, z: 0 },
    })
  }
  const gallery = cosmeticsFile.sternGalleries.find((g) => g.id === design.cosmetics.sternGalleryId)
  if (gallery) {
    items.push({
      label: gallery.name,
      group: 'fittings',
      massKg: gallery.massKg,
      position: { x: -0.46 * hull.length, y: hull.weatherDeckY - 0.5, z: 0 },
    })
  }

  // Ballast is stowed on the floor over the keelson; stores fill the hold above
  // it. Both sit low, which is what makes these ships stand up to their canvas.
  //
  // A stretched hull is ballasted and stored in proportion to her length: hold
  // capacity grows with length, so leaving these two fixed would make a longer
  // ship float progressively shallower and stiffer than the one she was
  // stretched from. The factor is exactly 1 at the preset length, so a design
  // that never touches the length slider is unchanged. Beam and depth are
  // deliberately not in it: beam's effect on stability is tuned against the
  // demo scripts, and depth is the draught slider's whole point.
  const holdScale = hull.params.keelLength / preset.params.keelLength
  items.push({
    label: 'Iron and shingle ballast',
    group: 'ballast',
    massKg: preset.ballastTonnes * 1000 * holdScale,
    position: { x: -0.02 * hull.length, y: 0.13 * hull.params.depthOfHold, z: 0 },
  })
  items.push({
    label: 'Water, provisions and powder',
    group: 'stores',
    massKg: preset.storesTonnes * 1000 * holdScale,
    position: { x: -0.01 * hull.length, y: 0.34 * hull.params.depthOfHold, z: 0 },
  })

  const gunCrew = countGunCrew(sockets, design)
  const crewEstimate = preset.baseCrew + gunCrew
  items.push({
    label: "Ship's company",
    group: 'crew',
    massKg: crewEstimate * CREW_MASS_KG,
    position: { x: 0, y: hull.params.depthOfHold + 0.5, z: 0 },
  })

  return {
    design,
    preset,
    hull,
    sockets,
    sails,
    sailAreaM2,
    masses: combineMasses(items),
    wettedAreaM2,
    gunCrew,
    crewEstimate,
  }
}

export function countGunCrew(sockets: Sockets, design: Design): number {
  let crew = 0
  for (const socket of sockets.mounts) {
    const config = design.mounts[socket.id]
    if (!config || !config.gunId) continue
    const gun = findGun(config.gunId)
    if (!gun) continue
    const port = Math.min(config.port, socket.maxPerSide)
    const starboard = Math.min(config.starboard, socket.maxPerSide)
    // Crews serve one broadside at a time, so the larger side sets the need.
    crew += Math.max(port, starboard) * gun.crewPerGun
  }
  return crew
}
