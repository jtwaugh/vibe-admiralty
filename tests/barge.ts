import type { HullSection } from '../src/physics/hydrostatics'
import { STATION_COUNT } from '../src/hull/stations'

/**
 * A rectangular box barge with closed-form hydrostatics, built directly as
 * station polygons so the analytic tests do not depend on the parametric hull.
 */
export function boxBarge(length: number, beam: number, depth: number): HullSection[] {
  const half = beam / 2
  const sections: HullSection[] = []
  for (let i = 0; i < STATION_COUNT; i++) {
    const x = -length / 2 + (length * i) / (STATION_COUNT - 1)
    sections.push({
      x,
      polygon: [
        { z: -half, y: 0 },
        { z: half, y: 0 },
        { z: half, y: depth },
        { z: -half, y: depth },
      ],
    })
  }
  return sections
}

/** Analytic upright hydrostatics for a box barge of the given mass. */
export function bargeAnalytic(
  length: number,
  beam: number,
  massKg: number,
  waterDensity: number,
) {
  const volume = massKg / waterDensity
  const draft = volume / (length * beam)
  const kb = draft / 2
  const bm = (beam * beam) / (12 * draft)
  return { volume, draft, kb, bm }
}
