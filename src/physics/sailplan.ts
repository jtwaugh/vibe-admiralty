import { sailsFile } from '../data'
import type { SailPlanId, SailTier } from '../data/schemas'
import type { Hull } from '../hull/stations'
import type { Sockets } from '../hull/sockets'
import { mastName } from '../hull/sockets'

/** A point in the ship's centreline plane: +x forward, +y up from the baseline. */
export type SailPoint = { x: number; y: number }

export type SailInstance = {
  /** Stable id used as the glTF node name and the rig state key. */
  id: string
  mastIndex: number
  mastLabel: string
  tier: SailTier
  areaM2: number
  /** Centre of effort in ship-local coordinates, the centroid of the cloth. */
  coeX: number
  coeY: number
  coefficient: number
  /** How close to the centreline the sail can be trimmed; see the data file. */
  minTrimDeg: number
  /** Height of the yard the sail hangs from, above the baseline. */
  yardY: number
  /** Half width of the yard. */
  yardHalfSpan: number
  /**
   * For fore-and-aft sails, the corners of the cloth in the centreline plane,
   * head first. Empty for square sails, which are described by their yard.
   */
  corners: SailPoint[]
}

function centroid(points: SailPoint[]): SailPoint {
  // Area centroid of the polygon, which is where the wind's force acts.
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const cross = a.x * b.y - b.x * a.y
    area += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  if (Math.abs(area) < 1e-6) {
    const n = points.length
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    }
  }
  return { x: cx / (3 * area), y: cy / (3 * area) }
}

/**
 * Sail areas scale with beam, so a wider hull carries more canvas and the
 * over-canvased plan stays over-canvased at any size. Every sail's drawn shape
 * and its centre of effort come from the same numbers: the scene draws exactly
 * what the physics pushes on.
 */
export function buildSailPlan(
  hull: Hull,
  sockets: Sockets,
  planId: SailPlanId,
): SailInstance[] {
  const plan = sailsFile.plans.find((p) => p.id === planId) ?? sailsFile.plans[1]
  const masts = sockets.masts
  const beam = hull.params.beam
  const unitArea = beam * beam * plan.areaScale
  const sails: SailInstance[] = []

  for (const mast of masts) {
    const label = mastName(masts.length, mast.index)
    for (const def of sailsFile.squareSails) {
      const area = def.areaFactor * unitArea
      const halfSpan = Math.sqrt(area / 0.62) / 2
      const height = area / (2 * halfSpan)
      // The data gives the height of the centre of effort; the yard is half the
      // sail's depth above it, because the cloth hangs below the spar.
      const coeY = mast.deckY + def.heightFactor * beam
      sails.push({
        id: `${label}-${def.tier}`,
        mastIndex: mast.index,
        mastLabel: label,
        tier: def.tier,
        areaM2: area,
        coeX: mast.x,
        coeY,
        coefficient: def.coefficient,
        minTrimDeg: def.minTrimDeg,
        yardY: coeY + height / 2,
        yardHalfSpan: halfSpan,
        corners: [],
      })
    }
  }

  // Jibs set on the head rig, forward of the foremost mast; the spanker sets
  // on a gaff and boom abaft the aftmost.
  const foremost = masts[masts.length - 1]
  const aftmost = masts[0]
  for (const def of sailsFile.foreAndAft) {
    const isJib = def.tier === 'jib'
    const mast = isJib ? foremost : aftmost
    const label = mastName(masts.length, mast.index)
    const area = def.areaFactor * unitArea
    const corners = isJib
      ? jibCorners(sockets, mast.index)
      : spankerCorners(hull, sockets, mast.index)
    const centre = centroid(corners)
    sails.push({
      id: `${label}-${def.tier}`,
      mastIndex: mast.index,
      mastLabel: label,
      tier: def.tier,
      areaM2: area,
      coeX: centre.x,
      coeY: centre.y,
      coefficient: def.coefficient,
      minTrimDeg: def.minTrimDeg,
      yardY: Math.max(...corners.map((p) => p.y)),
      yardHalfSpan: Math.sqrt(area) / 2,
      corners,
    })
  }

  return sails
}

/** Head, clew and tack of the headsail group, hung on the fore topmast stay. */
export function jibCorners(sockets: Sockets, mastIndex: number): SailPoint[] {
  const mast = sockets.masts[mastIndex]
  const bowsprit = sockets.bowsprit
  const rise = mast.truckY - mast.deckY
  return [
    { x: mast.x + 0.4, y: mast.deckY + 0.62 * rise },
    { x: mast.x + 0.4, y: mast.deckY + 1.6 },
    { x: bowsprit.tipX, y: bowsprit.tipY },
  ]
}

/** Throat, tack, clew and peak of the spanker, on its gaff and boom. */
export function spankerCorners(
  hull: Hull,
  sockets: Sockets,
  mastIndex: number,
): SailPoint[] {
  const mast = sockets.masts[mastIndex]
  const rise = mast.truckY - mast.deckY
  const boom = 0.3 * hull.length
  return [
    { x: mast.x - 0.35, y: mast.deckY + 0.42 * rise },
    { x: mast.x - 0.35, y: mast.deckY + 1.9 },
    { x: mast.x - boom, y: mast.deckY + 2.5 },
    { x: mast.x - boom * 0.74, y: mast.deckY + 0.5 * rise },
  ]
}

export function totalSailArea(sails: SailInstance[]): number {
  return sails.reduce((sum, s) => sum + s.areaM2, 0)
}
