import { findGun, timberFile } from '../data'
import { GUNPORT_SILL_HEIGHT } from '../hull/sockets'
import type { Derived } from '../export/schema'
import { costOf } from './cost'
import type { CostBreakdown } from './cost'
import {
  hullSections,
  metacentricHeight,
  solveEquilibriumHeel,
  solveFloating,
} from './hydrostatics'
import type { FloatState, HullSection } from './hydrostatics'
import type { ShipModel } from './masses'

export type DerivedStats = Derived & {
  /** Heel each way at which the first gunport goes under. */
  downfloodingDeg: { port: number; starboard: number }
  sections: HullSection[]
  upright: FloatState
  cost: CostBreakdown
  sailAreaM2: number
  /** Freeboard to the lowest gunport sill; negative means the ports are awash. */
  gunportFreeboardM: number
}

/** Hull speed from the waterline length, nudged by copper and by sail area. */
function speedEstimate(model: ShipModel, waterlineLength: number): number {
  const hullSpeedKn = 2.43 * Math.sqrt(Math.max(1, waterlineLength))
  const sailPower = model.sailAreaM2 / Math.max(1, model.masses.totalKg / 1000)
  const rigFactor = 0.55 + 0.15 * Math.min(2, sailPower)
  const copper = model.design.cosmetics.copperSheathing
    ? timberFile.copperSheathing.speedBonusKn
    : 0
  return hullSpeedKn * rigFactor + copper
}

export function computeDerived(model: ShipModel): DerivedStats {
  const sections = hullSections(model.hull)
  const mass = model.masses.totalKg
  const cg = model.masses.centreOfGravity

  const upright = solveFloating(sections, mass, cg)
  const gm = metacentricHeight(sections, mass, cg, { trimRad: upright.trimRad })
  const equilibrium = solveEquilibriumHeel(sections, mass, cg, () => 0, {
    openings: model.sockets.openings,
  })

  let portLb = 0
  let starboardLb = 0
  let gunKg = 0
  for (const socket of model.sockets.mounts) {
    const config = model.design.mounts[socket.id]
    if (!config || !config.gunId) continue
    const gun = findGun(config.gunId)
    if (!gun) continue
    const port = Math.min(config.port, socket.maxPerSide)
    const starboard = Math.min(config.starboard, socket.maxPerSide)
    portLb += port * gun.shotWeightLb
    starboardLb += starboard * gun.shotWeightLb
    gunKg += (port + starboard) * gun.massKg
  }

  const cost = costOf(model)
  const lowestGunDeckY = model.hull.decks[0].y
  const waterlineY = upright.offset
  const gunportFreeboardM = lowestGunDeckY + GUNPORT_SILL_HEIGHT - waterlineY

  return {
    displacementTonnes: mass / 1000,
    draftM: upright.draft,
    gmM: gm,
    staticListDeg: equilibrium.capsized ? NaN : equilibrium.heelDeg,
    capsizesAtRest: equilibrium.capsized,
    totalGunWeightTonnes: gunKg / 1000,
    broadsideWeightPortLb: portLb,
    broadsideWeightStarboardLb: starboardLb,
    crewEstimate: model.crewEstimate,
    maxSpeedEstimateKn: speedEstimate(model, model.hull.length * 0.94),
    totalCostPounds: cost.total,
    sections,
    upright,
    cost,
    sailAreaM2: model.sailAreaM2,
    gunportFreeboardM,
    downfloodingDeg: equilibrium.downfloodingDeg,
  }
}
