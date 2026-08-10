import { cosmeticsFile, findGun, getSpecies, sailsFile, timberFile } from '../data'
import { railLength } from '../hull/areas'
import type { ShipModel } from './masses'

export type CostBreakdown = {
  hullYard: number
  timber: number
  copper: number
  nettings: number
  rig: number
  guns: number
  cosmetics: number
  total: number
}

/**
 * Yard cost in period pounds sterling. Historically plausible ordering matters
 * more than the absolute figures (SPEC §5): a third rate lands near £50,000.
 */
export function costOf(model: ShipModel): CostBreakdown {
  const species = getSpecies(model.design.timber.speciesId)
  const structureTonnes = model.masses.structureKg / 1000

  const timber = structureTonnes * species.costPerTonnePounds
  // Fitting out, fastenings, boats and labour scale with the size of the ship.
  const hullYard = model.preset.hullBaseCostPounds
  const copper = model.design.cosmetics.copperSheathing
    ? model.wettedAreaM2 * timberFile.copperSheathing.costPoundsPerSquareMetre
    : 0
  const nettings = model.design.timber.nettings
    ? railLength(model.hull) * timberFile.nettings.costPoundsPerMetre
    : 0
  const rig = model.sailAreaM2 * sailsFile.rigCostPoundsPerSquareMetre

  let guns = 0
  for (const socket of model.sockets.mounts) {
    const config = model.design.mounts[socket.id]
    if (!config || !config.gunId) continue
    const gun = findGun(config.gunId)
    if (!gun) continue
    const count =
      Math.min(config.port, socket.maxPerSide) + Math.min(config.starboard, socket.maxPerSide)
    guns += count * gun.costPounds
  }

  const figurehead = cosmeticsFile.figureheads.find(
    (f) => f.id === model.design.cosmetics.figureheadId,
  )
  const gallery = cosmeticsFile.sternGalleries.find(
    (g) => g.id === model.design.cosmetics.sternGalleryId,
  )
  const paint = cosmeticsFile.paintSchemes.find(
    (p) => p.id === model.design.cosmetics.paintSchemeId,
  )
  const cosmetics =
    (figurehead?.costPounds ?? 0) + (gallery?.costPounds ?? 0) + (paint?.costPounds ?? 0)

  const total = hullYard + timber + copper + nettings + rig + guns + cosmetics
  return { hullYard, timber, copper, nettings, rig, guns, cosmetics, total }
}
