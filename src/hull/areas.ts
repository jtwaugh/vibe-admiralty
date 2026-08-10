import type { TimberZoneId } from '../data/schemas'
import { integrateUniform } from '../physics/hydrostatics'
import type { Hull, Station, Vec2 } from './stations'
import { deckYAtU, halfBreadthAt } from './stations'

/**
 * Surface area of one timber zone and the centroid of that surface. Zone masses
 * are area x thickness x density, applied at the centroid, so wales end up low
 * and stabilising while bulwarks end up high and destabilising with no special
 * casing (SPEC §5).
 */
export type ZoneSurface = {
  areaM2: number
  centroid: { x: number; y: number }
}

/** Height bands for the shell zones, as fractions of the depth of hold. */
const BOTTOM_TOP = 0.62
const WALES_TOP = 0.94

type Band = { lo: (hull: Hull, station: Station) => number; hi: (hull: Hull, station: Station) => number }

const SHELL_BANDS: Record<'bottom' | 'wales' | 'topsides' | 'bulwarks', Band> = {
  bottom: {
    lo: (_h, s) => s.keelY,
    hi: (h) => BOTTOM_TOP * h.params.depthOfHold,
  },
  wales: {
    lo: (h) => BOTTOM_TOP * h.params.depthOfHold,
    hi: (h) => WALES_TOP * h.params.depthOfHold,
  },
  topsides: {
    lo: (h) => WALES_TOP * h.params.depthOfHold,
    hi: (h, s) => s.railY - h.params.freeboard,
  },
  bulwarks: {
    lo: (h, s) => s.railY - h.params.freeboard,
    hi: (_h, s) => s.railY,
  },
}

/** Arc length of a half section between two heights, and its height centroid. */
function girthBetween(half: Vec2[], lo: number, hi: number): { girth: number; yBar: number } {
  let girth = 0
  let moment = 0
  for (let i = 1; i < half.length; i++) {
    const a = half[i - 1]
    const b = half[i]
    if (b.y <= lo || a.y >= hi) continue
    // Trim the segment to the band before measuring it.
    let za = a.z
    let ya = a.y
    let zb = b.z
    let yb = b.y
    if (ya < lo) {
      const t = (lo - ya) / (yb - ya)
      za = a.z + (b.z - a.z) * t
      ya = lo
    }
    if (yb > hi) {
      const t = (hi - a.y) / (b.y - a.y)
      zb = a.z + (b.z - a.z) * t
      yb = hi
    }
    const len = Math.hypot(zb - za, yb - ya)
    girth += len
    moment += len * ((ya + yb) / 2)
  }
  return { girth, yBar: girth > 0 ? moment / girth : lo }
}

function shellZone(hull: Hull, band: Band): ZoneSurface {
  const girths: number[] = []
  const yMoments: number[] = []
  const xMoments: number[] = []
  for (const station of hull.stations) {
    const lo = band.lo(hull, station)
    const hi = band.hi(hull, station)
    // Both sides of the hull.
    const { girth, yBar } = girthBetween(station.half, Math.min(lo, hi), Math.max(lo, hi))
    const g = girth * 2
    girths.push(g)
    yMoments.push(g * yBar)
    xMoments.push(g * station.x)
  }
  const dx = hull.stations[1].x - hull.stations[0].x
  const areaM2 = integrateUniform(girths, dx)
  if (areaM2 <= 1e-9) return { areaM2: 0, centroid: { x: 0, y: 0 } }
  return {
    areaM2,
    centroid: {
      x: integrateUniform(xMoments, dx) / areaM2,
      y: integrateUniform(yMoments, dx) / areaM2,
    },
  }
}

/** Plan area of one deck and the centroid of that area. */
export function deckSurface(hull: Hull, deckY: number): ZoneSurface {
  const widths: number[] = []
  const xMoments: number[] = []
  const yMoments: number[] = []
  for (const station of hull.stations) {
    const y = deckYAtU(hull, deckY, station.u)
    const w = 2 * halfBreadthAt(hull, station.u, y)
    widths.push(w)
    xMoments.push(w * station.x)
    yMoments.push(w * y)
  }
  const dx = hull.stations[1].x - hull.stations[0].x
  const areaM2 = integrateUniform(widths, dx)
  if (areaM2 <= 1e-9) return { areaM2: 0, centroid: { x: 0, y: 0 } }
  return {
    areaM2,
    centroid: {
      x: integrateUniform(xMoments, dx) / areaM2,
      y: integrateUniform(yMoments, dx) / areaM2,
    },
  }
}

export type ZoneSurfaces = Record<TimberZoneId, ZoneSurface>

export function hullZoneSurfaces(hull: Hull): ZoneSurfaces {
  const decks = hull.decks.map((d) => deckSurface(hull, d.y))
  const totalDeckArea = decks.reduce((sum, d) => sum + d.areaM2, 0)
  const deckCentroid =
    totalDeckArea > 0
      ? {
          x: decks.reduce((s, d) => s + d.areaM2 * d.centroid.x, 0) / totalDeckArea,
          y: decks.reduce((s, d) => s + d.areaM2 * d.centroid.y, 0) / totalDeckArea,
        }
      : { x: 0, y: 0 }

  return {
    bottom: shellZone(hull, SHELL_BANDS.bottom),
    wales: shellZone(hull, SHELL_BANDS.wales),
    topsides: shellZone(hull, SHELL_BANDS.topsides),
    bulwarks: shellZone(hull, SHELL_BANDS.bulwarks),
    deck: { areaM2: totalDeckArea, centroid: deckCentroid },
  }
}

/** Length of rail available for hammock nettings: both sides of the ship. */
export function railLength(hull: Hull): number {
  let total = 0
  for (let i = 1; i < hull.stations.length; i++) {
    const a = hull.stations[i - 1]
    const b = hull.stations[i]
    total += Math.hypot(b.x - a.x, b.railY - a.railY)
  }
  return total * 2
}
