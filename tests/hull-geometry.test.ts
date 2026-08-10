import { describe, expect, it } from 'vitest'
import { getPreset } from '../src/data'
import { loftHull } from '../src/hull/loft'
import { buildSockets } from '../src/hull/sockets'
import {
  STATION_COUNT,
  buildHull,
  halfBreadthAt,
  hullDepth,
  sectionPolygon,
} from '../src/hull/stations'
import { polygonArea } from '../src/physics/hydrostatics'

const preset = getPreset('frigate-38')
const hull = buildHull(preset.params)

describe('station generation', () => {
  it('produces the 21 stations SPEC asks for, ordered stern to bow', () => {
    expect(hull.stations).toHaveLength(STATION_COUNT)
    for (let i = 1; i < hull.stations.length; i++) {
      expect(hull.stations[i].x).toBeGreaterThan(hull.stations[i - 1].x)
    }
    expect(hull.stations[0].x).toBeCloseTo(-preset.params.keelLength / 2, 9)
    expect(hull.stations[STATION_COUNT - 1].x).toBeCloseTo(preset.params.keelLength / 2, 9)
  })

  it('keeps every half section on the starboard side and rising to the rail', () => {
    for (const station of hull.stations) {
      expect(station.half[0].z).toBeCloseTo(0, 9)
      for (let i = 1; i < station.half.length; i++) {
        expect(station.half[i].z).toBeGreaterThanOrEqual(-1e-9)
        expect(station.half[i].y).toBeGreaterThan(station.half[i - 1].y - 1e-9)
      }
      expect(station.half[station.half.length - 1].y).toBeCloseTo(station.railY, 9)
    }
  })

  it('is widest near midships and finest at the bow', () => {
    const widest = hull.stations.reduce((a, b) => (b.maxHalfBeam > a.maxHalfBeam ? b : a))
    expect(widest.u).toBeGreaterThan(0.4)
    expect(widest.u).toBeLessThan(0.65)
    // The point of maximum breadth falls between stations, so the widest
    // station is a shade narrower than the nominal beam.
    expect(widest.maxHalfBeam).toBeLessThanOrEqual(preset.params.beam / 2 + 1e-9)
    expect(widest.maxHalfBeam).toBeGreaterThan((preset.params.beam / 2) * 0.99)
    const bow = hull.stations[STATION_COUNT - 1]
    expect(bow.maxHalfBeam).toBeLessThan(preset.params.beam / 8)
  })

  it('widens every section when the beam slider moves', () => {
    const wide = buildHull({ ...preset.params, beam: preset.ranges.beam.max })
    const narrow = buildHull({ ...preset.params, beam: preset.ranges.beam.min })
    for (let i = 0; i < STATION_COUNT; i++) {
      expect(wide.stations[i].maxHalfBeam).toBeGreaterThan(narrow.stations[i].maxHalfBeam)
    }
    expect(polygonArea(sectionPolygon(wide.stations[10]))).toBeGreaterThan(
      polygonArea(sectionPolygon(narrow.stations[10])),
    )
  })

  it('raises the rail at both ends when sheer increases', () => {
    const flat = buildHull({ ...preset.params, sheer: 0 })
    const curved = buildHull({ ...preset.params, sheer: 1 })
    expect(curved.stations[0].railY).toBeGreaterThan(flat.stations[0].railY)
    expect(curved.stations[STATION_COUNT - 1].railY).toBeGreaterThan(
      flat.stations[STATION_COUNT - 1].railY,
    )
    // Amidships the sheer line is at its lowest and barely moves.
    expect(curved.stations[8].railY).toBeCloseTo(flat.stations[8].railY, 1)
  })
})

describe('lofted mesh', () => {
  const lofted = loftHull(hull)

  it('emits complete, indexed geometry for every part', () => {
    for (const part of [lofted.shell, lofted.deck, lofted.bulwark]) {
      expect(part.positions.length).toBeGreaterThan(0)
      expect(part.positions.length % 3).toBe(0)
      expect(part.normals.length).toBe(part.positions.length)
      expect(part.uvs.length).toBe((part.positions.length / 3) * 2)
      expect(part.indices.length % 3).toBe(0)
      const vertexCount = part.positions.length / 3
      for (const index of part.indices) {
        expect(index).toBeLessThan(vertexCount)
      }
      for (const value of part.positions) expect(Number.isFinite(value)).toBe(true)
      for (const value of part.normals) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('points shell normals outward, not into the hull', () => {
    const { positions, normals } = lofted.shell
    let outward = 0
    let inward = 0
    for (let i = 0; i < positions.length; i += 3) {
      const z = positions[i + 2]
      // Skip the keel line and the ends, where the normal is not athwartships.
      if (Math.abs(z) < 1) continue
      const dot = z * normals[i + 2]
      if (dot > 0) outward++
      else if (dot < 0) inward++
    }
    expect(outward).toBeGreaterThan(0)
    expect(inward / (outward + inward)).toBeLessThan(0.05)
  })

  it('keeps the whole mesh inside the hull envelope', () => {
    const depth = hullDepth(hull.params)
    for (const part of [lofted.shell, lofted.deck, lofted.bulwark]) {
      for (let i = 0; i < part.positions.length; i += 3) {
        expect(Math.abs(part.positions[i])).toBeLessThanOrEqual(hull.length / 2 + 1e-6)
        expect(part.positions[i + 1]).toBeGreaterThanOrEqual(-1e-6)
        expect(part.positions[i + 1]).toBeLessThanOrEqual(depth + 2)
        expect(Math.abs(part.positions[i + 2])).toBeLessThanOrEqual(hull.params.beam / 2 + 1e-6)
      }
    }
  })
})

describe('sockets', () => {
  const sockets = buildSockets(hull, preset)

  it('places a battery for each gun deck plus the upper works', () => {
    const ids = sockets.mounts.map((m) => m.id)
    expect(ids).toContain('battery-deck-0')
    expect(ids).toContain('quarterdeck')
    expect(ids).toContain('forecastle')
    expect(ids).toContain('bow-chaser')
    expect(ids).toContain('stern-chaser')
    expect(ids).toContain('swivel-rail')
  })

  it('gives every battery as many positions as it has guns per side', () => {
    const battery = sockets.mounts.find((m) => m.id === 'battery-deck-0')!
    expect(battery.positions).toHaveLength(preset.gunsPerSideByDeck[0])
    expect(battery.maxPerSide).toBe(preset.gunsPerSideByDeck[0])
  })

  it('seats every gun inside the hull and above its deck', () => {
    for (const socket of sockets.mounts) {
      for (const position of socket.positions) {
        expect(Math.abs(position.x)).toBeLessThan(hull.length / 2)
        expect(position.z).toBeGreaterThan(0)
        const u = position.x / hull.length + 0.5
        expect(position.z).toBeLessThanOrEqual(halfBreadthAt(hull, u, position.y) + 0.01)
        expect(position.y).toBeGreaterThan(hull.decks[socket.deckIndex].y)
      }
    }
  })

  it('moves the sockets outboard when the beam slider widens the hull', () => {
    const wide = buildHull({ ...preset.params, beam: preset.ranges.beam.max })
    const wideSockets = buildSockets(wide, preset)
    const before = buildSockets(hull, preset).mounts.find((m) => m.id === 'battery-deck-0')!
    const after = wideSockets.mounts.find((m) => m.id === 'battery-deck-0')!
    for (let i = 0; i < before.positions.length; i++) {
      expect(after.positions[i].z).toBeGreaterThan(before.positions[i].z)
    }
  })

  it('puts one gunport opening on each side of every port on a gun deck', () => {
    expect(sockets.openings).toHaveLength(preset.gunsPerSideByDeck[0] * 2)
    const port = sockets.openings.filter((o) => o.z < 0)
    const starboard = sockets.openings.filter((o) => o.z > 0)
    expect(port).toHaveLength(starboard.length)
    for (const opening of sockets.openings) {
      expect(opening.y).toBeGreaterThan(hull.decks[0].y)
      expect(opening.y).toBeLessThan(hull.weatherDeckY)
    }
  })

  it('steps every mast on the keel and carries it above the deck', () => {
    expect(sockets.masts).toHaveLength(preset.mastCount)
    for (const mast of sockets.masts) {
      expect(mast.stepY).toBeLessThan(hull.params.depthOfHold)
      expect(mast.deckY).toBeGreaterThanOrEqual(hull.weatherDeckY)
      expect(mast.truckY).toBeGreaterThan(mast.deckY + hull.params.beam)
    }
  })
})
