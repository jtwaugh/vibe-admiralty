import { sailsFile } from '../data'
import type { SailPlanId, SailTier } from '../data/schemas'
import type { Hull } from '../hull/stations'
import type { MastSocket } from '../hull/sockets'
import { mastName } from '../hull/sockets'

export type SailInstance = {
  /** Stable id used as the glTF node name and the rig state key. */
  id: string
  mastIndex: number
  mastLabel: string
  tier: SailTier
  areaM2: number
  /** Centre of effort in ship-local coordinates. */
  coeX: number
  coeY: number
  coefficient: number
  /** Height of the yard the sail hangs from, above the baseline. */
  yardY: number
  /** Half width of the yard. */
  yardHalfSpan: number
}

/**
 * Sail areas and centres of effort scale with beam, so a wider hull carries
 * more canvas and the over-canvased plan stays over-canvased at any size.
 */
export function buildSailPlan(
  hull: Hull,
  masts: MastSocket[],
  planId: SailPlanId,
): SailInstance[] {
  const plan = sailsFile.plans.find((p) => p.id === planId) ?? sailsFile.plans[1]
  const beam = hull.params.beam
  const unitArea = beam * beam * plan.areaScale
  const sails: SailInstance[] = []

  for (const mast of masts) {
    const label = mastName(masts.length, mast.index)
    for (const def of sailsFile.squareSails) {
      const coeY = mast.deckY + def.heightFactor * beam
      sails.push({
        id: `${label}-${def.tier}`,
        mastIndex: mast.index,
        mastLabel: label,
        tier: def.tier,
        areaM2: def.areaFactor * unitArea,
        coeX: mast.x,
        coeY,
        coefficient: def.coefficient,
        yardY: coeY + Math.sqrt(def.areaFactor * unitArea) * 0.45,
        yardHalfSpan: Math.sqrt((def.areaFactor * unitArea) / 0.62) / 2,
      })
    }
  }

  // Jibs live forward of the foremost mast; the spanker abaft the aftmost.
  const foremost = masts[masts.length - 1]
  const aftmost = masts[0]
  for (const def of sailsFile.foreAndAft) {
    const isJib = def.tier === 'jib'
    const mast = isJib ? foremost : aftmost
    const label = mastName(masts.length, mast.index)
    const area = def.areaFactor * unitArea
    const coeY = mast.deckY + def.heightFactor * beam
    sails.push({
      id: `${label}-${def.tier}`,
      mastIndex: mast.index,
      mastLabel: label,
      tier: def.tier,
      areaM2: area,
      coeX: mast.x + (isJib ? 0.14 : -0.12) * hull.params.keelLength,
      coeY,
      coefficient: def.coefficient,
      yardY: coeY + Math.sqrt(area) * 0.5,
      yardHalfSpan: Math.sqrt(area) / 2,
    })
  }

  return sails
}

export function totalSailArea(sails: SailInstance[]): number {
  return sails.reduce((sum, s) => sum + s.areaM2, 0)
}
