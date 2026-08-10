import type { HullPreset } from '../data/schemas'
import type { Vec3 } from '../physics/hydrostatics'
import type { Hull } from './stations'
import { deckYAtU, halfBreadthAt, railYAtU } from './stations'

export type SocketKind = 'battery' | 'chaser' | 'swivel'

export type MountSocket = {
  id: string
  kind: SocketKind
  label: string
  /** Index into hull.decks. */
  deckIndex: number
  maxPerSide: number
  /** Starboard-side position of each gun, fore to aft. Port mirrors z. */
  positions: Vec3[]
  /** Where the clickable marker sits, on the starboard shell. */
  marker: Vec3
}

export type MastSocket = {
  index: number
  label: string
  /** Longitudinal position of the mast. */
  x: number
  /** Height of the keelson step the mast is footed on. */
  stepY: number
  /** Height where the mast passes through the weather deck. */
  deckY: number
  /** Height of the mast truck. */
  truckY: number
}

export type Sockets = {
  mounts: MountSocket[]
  masts: MastSocket[]
  /** Position of the wheel, used for the helm crew station. */
  helm: Vec3
  /**
   * Unprotected openings on the shell: gunport sills on every gun deck, both
   * sides. When these go under, the ship downfloods and her stability ends.
   */
  openings: Vec3[]
}

/** Height of a gunport sill above the deck it opens onto. */
export const GUNPORT_SILL_HEIGHT = 0.55

/** Height of a gun's barrel axis above the deck it stands on. */
const GUN_AXIS_HEIGHT = 0.62
/** How far inboard of the shell the centre of a gun sits. */
const GUN_INBOARD = 0.55
/** Height of a swivel above the rail. */
const SWIVEL_RISE = 0.35

/** Longitudinal spans, as normalised position from stern (0) to bow (1). */
const BATTERY_SPAN: [number, number] = [0.16, 0.87]
const QUARTERDECK_SPAN: [number, number] = [0.07, 0.43]
const FORECASTLE_SPAN: [number, number] = [0.75, 0.93]
const SWIVEL_SPAN: [number, number] = [0.1, 0.6]
const BOW_CHASER_U = 0.95
const STERN_CHASER_U = 0.04

/** Mast positions as normalised position from the stern, by mast count. */
const MAST_LAYOUT: Record<number, number[]> = {
  1: [0.52],
  2: [0.3, 0.68],
  3: [0.24, 0.5, 0.76],
}

export const MAST_NAMES = ['mizzen', 'main', 'fore'] as const

/** Names run fore to aft in period usage; index 0 is the aftmost mast here. */
export function mastName(count: number, index: number): string {
  if (count === 1) return 'main'
  if (count === 2) return index === 0 ? 'main' : 'fore'
  return MAST_NAMES[index]
}

function spread(span: [number, number], count: number): number[] {
  if (count <= 0) return []
  const [a, b] = span
  const step = (b - a) / count
  return Array.from({ length: count }, (_, i) => a + step * (i + 0.5))
}

function gunPositions(
  hull: Hull,
  deckY: number,
  span: [number, number],
  count: number,
): Vec3[] {
  return spread(span, count).map((u) => {
    const y = deckYAtU(hull, deckY, u) + GUN_AXIS_HEIGHT
    const z = Math.max(0.4, halfBreadthAt(hull, u, y) - GUN_INBOARD)
    return { x: (u - 0.5) * hull.params.keelLength, y, z }
  })
}

function markerFor(hull: Hull, deckY: number, span: [number, number]): Vec3 {
  const u = (span[0] + span[1]) / 2
  const y = deckYAtU(hull, deckY, u) + GUN_AXIS_HEIGHT
  return { x: (u - 0.5) * hull.params.keelLength, y, z: halfBreadthAt(hull, u, y) }
}

/**
 * Every mount point on the ship, positioned from the station curves so that
 * moving a hull slider moves the sockets with it (SPEC §4).
 */
export function buildSockets(hull: Hull, preset: HullPreset): Sockets {
  const L = hull.params.keelLength
  const mounts: MountSocket[] = []

  preset.gunsPerSideByDeck.forEach((maxPerSide, deckIndex) => {
    if (deckIndex >= hull.params.deckCount) return
    const deckY = hull.decks[deckIndex].y
    mounts.push({
      id: `battery-deck-${deckIndex}`,
      kind: 'battery',
      label:
        hull.params.deckCount === 1
          ? 'Gun deck battery'
          : `${['Lower', 'Middle', 'Upper'][deckIndex]} deck battery`,
      deckIndex,
      maxPerSide,
      positions: gunPositions(hull, deckY, BATTERY_SPAN, maxPerSide),
      marker: markerFor(hull, deckY, BATTERY_SPAN),
    })
  })

  const weatherIndex = hull.decks.length - 1
  const weatherY = hull.weatherDeckY

  if (preset.quarterdeckGunsPerSide > 0) {
    mounts.push({
      id: 'quarterdeck',
      kind: 'battery',
      label: 'Quarterdeck battery',
      deckIndex: weatherIndex,
      maxPerSide: preset.quarterdeckGunsPerSide,
      positions: gunPositions(hull, weatherY, QUARTERDECK_SPAN, preset.quarterdeckGunsPerSide),
      marker: markerFor(hull, weatherY, QUARTERDECK_SPAN),
    })
  }

  if (preset.forecastleGunsPerSide > 0) {
    mounts.push({
      id: 'forecastle',
      kind: 'battery',
      label: 'Forecastle battery',
      deckIndex: weatherIndex,
      maxPerSide: preset.forecastleGunsPerSide,
      positions: gunPositions(hull, weatherY, FORECASTLE_SPAN, preset.forecastleGunsPerSide),
      marker: markerFor(hull, weatherY, FORECASTLE_SPAN),
    })
  }

  mounts.push({
    id: 'bow-chaser',
    kind: 'chaser',
    label: 'Bow chasers',
    deckIndex: weatherIndex,
    maxPerSide: 1,
    positions: gunPositions(hull, weatherY, [BOW_CHASER_U - 0.01, BOW_CHASER_U + 0.01], 1),
    marker: markerFor(hull, weatherY, [BOW_CHASER_U - 0.01, BOW_CHASER_U + 0.01]),
  })

  mounts.push({
    id: 'stern-chaser',
    kind: 'chaser',
    label: 'Stern chasers',
    deckIndex: weatherIndex,
    maxPerSide: 1,
    positions: gunPositions(hull, weatherY, [STERN_CHASER_U - 0.01, STERN_CHASER_U + 0.01], 1),
    marker: markerFor(hull, weatherY, [STERN_CHASER_U - 0.01, STERN_CHASER_U + 0.01]),
  })

  if (preset.swivelsPerSide > 0) {
    const positions = spread(SWIVEL_SPAN, preset.swivelsPerSide).map((u) => {
      const y = railYAtU(hull, u) + SWIVEL_RISE
      return { x: (u - 0.5) * L, y, z: halfBreadthAt(hull, u, railYAtU(hull, u)) }
    })
    mounts.push({
      id: 'swivel-rail',
      kind: 'swivel',
      label: 'Swivel rails',
      deckIndex: weatherIndex,
      maxPerSide: preset.swivelsPerSide,
      positions,
      marker: positions[Math.floor(positions.length / 2)],
    })
  }

  const layout = MAST_LAYOUT[preset.mastCount] ?? MAST_LAYOUT[3]
  const masts: MastSocket[] = layout.map((u, index) => {
    const stationIndex = Math.round(u * (hull.stations.length - 1))
    return {
      index,
      label: `${mastName(preset.mastCount, index)} mast`,
      x: (u - 0.5) * L,
      stepY: hull.stations[stationIndex].keelY + 0.4,
      deckY: deckYAtU(hull, hull.weatherDeckY, u),
      truckY: deckYAtU(hull, hull.weatherDeckY, u) + 2.7 * hull.params.beam,
    }
  })

  const openings: Vec3[] = []
  for (let deckIndex = 0; deckIndex < hull.params.deckCount; deckIndex++) {
    const deckY = hull.decks[deckIndex].y
    const count = preset.gunsPerSideByDeck[deckIndex] ?? 0
    for (const u of spread(BATTERY_SPAN, count)) {
      const y = deckYAtU(hull, deckY, u) + GUNPORT_SILL_HEIGHT
      const z = halfBreadthAt(hull, u, y)
      const x = (u - 0.5) * L
      openings.push({ x, y, z }, { x, y, z: -z })
    }
  }

  const helmU = 0.18
  return {
    mounts,
    masts,
    openings,
    helm: {
      x: (helmU - 0.5) * L,
      y: deckYAtU(hull, weatherY, helmU) + 0.9,
      z: 0,
    },
  }
}
