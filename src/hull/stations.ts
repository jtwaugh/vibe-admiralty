import type { HullParams } from '../data/schemas'

/**
 * A point on a transverse hull section: z is athwartships (+starboard),
 * y is up from the baseline (top of keel amidships).
 */
export type Vec2 = { z: number; y: number }

export type Station = {
  /** Longitudinal position, metres. -L/2 at the stern, +L/2 at the bow. */
  x: number
  /** Normalised position along the hull, 0 at the stern, 1 at the bow. */
  u: number
  /** Half section on the starboard side, ordered keel -> rail. All z >= 0. */
  half: Vec2[]
  /** Height of the rail at this station (top of the bulwark). */
  railY: number
  /** Height of the hull bottom at the centreline. */
  keelY: number
  /** Maximum half breadth at this station. */
  maxHalfBeam: number
}

export type DeckLevel = {
  /** 0 is the lowest gun deck. */
  index: number
  /** Deck height amidships, above the baseline. */
  y: number
  kind: 'gun' | 'weather'
}

export type Hull = {
  params: HullParams
  stations: Station[]
  /** Gun decks (lowest first) followed by the weather deck. */
  decks: DeckLevel[]
  /** Height of the weather (spar) deck amidships. */
  weatherDeckY: number
  /** Height of the rail amidships. */
  railY: number
  /** Total hull height amidships, baseline to rail. */
  depth: number
  length: number
}

/** Vertical spacing between stacked decks, metres. */
export const DECK_SPACING = 2.3

/** Number of transverse stations, per SPEC §4. */
export const STATION_COUNT = 21

/** Points sampled on each half section below and above the point of max breadth. */
const LOWER_SAMPLES = 9
const UPPER_SAMPLES = 5

/** Normalised position of maximum breadth, slightly forward of midships. */
const MAX_BEAM_U = 0.52
/** Normalised position of the lowest point of the sheer line. */
const SHEER_LOW_U = 0.42

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Half breadth at station u as a fraction of the maximum half breadth. */
function halfBeamFactor(u: number, params: HullParams): number {
  const sternEnd = params.sternType === 'square' ? 0.58 : 0.44
  const bowEnd = 0.05
  if (u >= MAX_BEAM_U) {
    const s = (u - MAX_BEAM_U) / (1 - MAX_BEAM_U)
    // A larger exponent keeps the hull wide further forward: a bluff bow.
    const kBow = 1.2 + 2.4 * params.bowFullness
    return 1 - (1 - bowEnd) * Math.pow(s, kBow)
  }
  const s = (MAX_BEAM_U - u) / MAX_BEAM_U
  return 1 - (1 - sternEnd) * Math.pow(s, 2.1)
}

/** Height of the hull bottom above the baseline: rising floor at both ends. */
function keelRise(u: number, params: HullParams): number {
  const d = params.depthOfHold
  if (u >= MAX_BEAM_U) {
    const s = (u - MAX_BEAM_U) / (1 - MAX_BEAM_U)
    return 0.62 * d * Math.pow(s, 2.6)
  }
  const s = (MAX_BEAM_U - u) / MAX_BEAM_U
  return 0.4 * d * Math.pow(s, 2.4)
}

/** Rise of the deck and rail lines above their amidships height. */
export function sheerRise(u: number, params: HullParams): number {
  const bow = params.sheer * 0.075 * params.keelLength
  const stern = bow * 0.7
  if (u >= SHEER_LOW_U) {
    const s = (u - SHEER_LOW_U) / (1 - SHEER_LOW_U)
    return bow * s * s
  }
  const s = (SHEER_LOW_U - u) / SHEER_LOW_U
  return stern * s * s
}

/**
 * How full the section is: 0 is a fine V, 1 is a box. Full amidships, fine at
 * the ends, and the bow half is scaled by bowFullness.
 */
function sectionFullness(u: number, params: HullParams): number {
  const spread = Math.max(MAX_BEAM_U, 1 - MAX_BEAM_U)
  const base = 1 - Math.pow(Math.abs(u - MAX_BEAM_U) / spread, 1.5)
  const bowScale = u >= MAX_BEAM_U ? 0.55 + 0.85 * params.bowFullness : 1
  return clamp(0.1 + 0.8 * base * bowScale, 0.04, 0.97)
}

/** Total hull height amidships, from the baseline to the top of the rail. */
export function hullDepth(params: HullParams): number {
  return params.depthOfHold + params.deckCount * DECK_SPACING + params.freeboard
}

export function deckLevels(params: HullParams): DeckLevel[] {
  const decks: DeckLevel[] = []
  for (let i = 0; i < params.deckCount; i++) {
    decks.push({ index: i, y: params.depthOfHold + i * DECK_SPACING, kind: 'gun' })
  }
  decks.push({
    index: params.deckCount,
    y: params.depthOfHold + params.deckCount * DECK_SPACING,
    kind: 'weather',
  })
  return decks
}

function buildHalfSection(u: number, params: HullParams): Vec2[] {
  const maxHalfBeam = Math.max(0.02, (params.beam / 2) * halfBeamFactor(u, params))
  const keelY = keelRise(u, params)
  const railY = hullDepth(params) + sheerRise(u, params)

  // The point of maximum breadth sits a little below the load waterline and
  // runs as a near-horizontal line the length of the hull.
  const yMax = clamp(0.75 * params.depthOfHold, keelY + 0.25 * (railY - keelY), keelY + 0.8 * (railY - keelY))

  const n = 1.5 + 2.4 * sectionFullness(u, params)
  const pts: Vec2[] = []

  // Lower body: superellipse quadrant from the keel out to maximum breadth.
  // ((yMax - y) / (yMax - keelY))^n + (z / maxHalfBeam)^n = 1
  for (let i = 0; i < LOWER_SAMPLES; i++) {
    const t = i / (LOWER_SAMPLES - 1)
    const y = keelY + t * (yMax - keelY)
    const z = maxHalfBeam * Math.pow(Math.max(0, 1 - Math.pow(1 - t, n)), 1 / n)
    pts.push({ z, y })
  }

  // Upper body: tumblehome from maximum breadth in to the rail.
  const tumble = 0.16 * (1 - Math.pow(Math.abs(u - MAX_BEAM_U) / 0.55, 2))
  const tumbleAmount = clamp(tumble, 0.02, 0.16)
  for (let i = 1; i <= UPPER_SAMPLES; i++) {
    const t = i / UPPER_SAMPLES
    const y = yMax + t * (railY - yMax)
    const z = maxHalfBeam * (1 - tumbleAmount * Math.pow(t, 1.6))
    pts.push({ z, y })
  }

  return pts
}

export function buildHull(params: HullParams): Hull {
  const stations: Station[] = []
  for (let i = 0; i < STATION_COUNT; i++) {
    const u = i / (STATION_COUNT - 1)
    const half = buildHalfSection(u, params)
    stations.push({
      x: (u - 0.5) * params.keelLength,
      u,
      half,
      railY: hullDepth(params) + sheerRise(u, params),
      keelY: keelRise(u, params),
      maxHalfBeam: Math.max(...half.map((p) => p.z)),
    })
  }
  const decks = deckLevels(params)
  return {
    params,
    stations,
    decks,
    weatherDeckY: decks[decks.length - 1].y,
    railY: hullDepth(params),
    depth: hullDepth(params),
    length: params.keelLength,
  }
}

/**
 * The closed transverse section polygon: up the port side, across the keel,
 * up the starboard side, closed by the deck edge. Counter-clockwise in (z, y).
 */
export function sectionPolygon(station: Station): Vec2[] {
  const poly: Vec2[] = []
  for (let i = station.half.length - 1; i >= 1; i--) {
    poly.push({ z: -station.half[i].z, y: station.half[i].y })
  }
  for (const p of station.half) poly.push({ z: p.z, y: p.y })
  return poly
}

/** Longitudinal position of the station nearest to normalised position u. */
export function xAtU(hull: Hull, u: number): number {
  return (u - 0.5) * hull.params.keelLength
}

/** Linear interpolation of the half section at an arbitrary u. */
export function halfSectionAtU(hull: Hull, u: number): Vec2[] {
  const clamped = clamp(u, 0, 1)
  const f = clamped * (STATION_COUNT - 1)
  const i = Math.min(STATION_COUNT - 2, Math.floor(f))
  const t = f - i
  const a = hull.stations[i].half
  const b = hull.stations[i + 1].half
  return a.map((p, k) => ({ z: p.z + (b[k].z - p.z) * t, y: p.y + (b[k].y - p.y) * t }))
}

/**
 * Half breadth of the hull at normalised position u and height y. Returns 0
 * below the hull bottom or above the rail. Used to seat sockets on the shell.
 */
export function halfBreadthAt(hull: Hull, u: number, y: number): number {
  const half = halfSectionAtU(hull, u)
  if (y <= half[0].y) return 0
  const top = half[half.length - 1]
  if (y >= top.y) return top.z
  for (let i = 1; i < half.length; i++) {
    if (y <= half[i].y) {
      const a = half[i - 1]
      const b = half[i]
      const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y)
      return a.z + (b.z - a.z) * t
    }
  }
  return top.z
}

/** Rail height at an arbitrary normalised position. */
export function railYAtU(hull: Hull, u: number): number {
  return hullDepth(hull.params) + sheerRise(clamp(u, 0, 1), hull.params)
}

/** Height of a deck at an arbitrary normalised position; decks follow the sheer. */
export function deckYAtU(hull: Hull, deckY: number, u: number): number {
  return deckY + sheerRise(clamp(u, 0, 1), hull.params)
}
