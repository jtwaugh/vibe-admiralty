import type { Hull, Vec2 } from './stations'
import { deckYAtU, halfBreadthAt, hullDepth, sheerRise } from './stations'

/**
 * Plain typed arrays so the loft can be unit tested without a WebGL context.
 * Positions are in ship-local coordinates: +x forward, +y up, +z starboard.
 */
export type MeshData = {
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
}

export type LoftedHull = {
  shell: MeshData
  deck: MeshData
  bulwark: MeshData
}

/** Thickness of the bulwark, used for the inboard face and the rail cap. */
const BULWARK_THICKNESS = 0.18

function emptyMesh(): MeshData {
  return { positions: [], normals: [], uvs: [], indices: [] }
}

export class MeshBuilder {
  readonly data = emptyMesh()

  vertex(x: number, y: number, z: number, u: number, v: number): number {
    const index = this.data.positions.length / 3
    this.data.positions.push(x, y, z)
    this.data.normals.push(0, 0, 0)
    this.data.uvs.push(u, v)
    return index
  }

  triangle(a: number, b: number, c: number) {
    this.data.indices.push(a, b, c)
  }

  quad(a: number, b: number, c: number, d: number) {
    this.triangle(a, b, c)
    this.triangle(a, c, d)
  }

  /** Area-weighted vertex normals, which is all a flat-ish PBR look needs. */
  finish(): MeshData {
    const { positions, normals, indices } = this.data
    for (let i = 0; i < indices.length; i += 3) {
      const [ia, ib, ic] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3]
      const ax = positions[ib] - positions[ia]
      const ay = positions[ib + 1] - positions[ia + 1]
      const az = positions[ib + 2] - positions[ia + 2]
      const bx = positions[ic] - positions[ia]
      const by = positions[ic + 1] - positions[ia + 1]
      const bz = positions[ic + 2] - positions[ia + 2]
      const nx = ay * bz - az * by
      const ny = az * bx - ax * bz
      const nz = ax * by - ay * bx
      for (const base of [ia, ib, ic]) {
        normals[base] += nx
        normals[base + 1] += ny
        normals[base + 2] += nz
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
      normals[i] /= len
      normals[i + 1] /= len
      normals[i + 2] /= len
    }
    return this.data
  }
}

/**
 * Texture v coordinate. Subtracting the sheer before normalising makes bands
 * drawn at a constant v follow the sheer line, the way a painted strake does.
 */
export function paintV(hull: Hull, u: number, y: number): number {
  return (y - sheerRise(u, hull.params)) / hullDepth(hull.params)
}

/** The full section ring: port rail down to the keel and up to starboard rail. */
function sectionRing(half: Vec2[]): Vec2[] {
  const ring: Vec2[] = []
  for (let i = half.length - 1; i >= 1; i--) ring.push({ z: -half[i].z, y: half[i].y })
  for (const p of half) ring.push({ z: p.z, y: p.y })
  return ring
}

function buildShell(hull: Hull): MeshData {
  const b = new MeshBuilder()
  const stations = hull.stations
  const rings = stations.map((s) => sectionRing(s.half))
  const ringSize = rings[0].length

  const grid: number[][] = rings.map((ring, i) => {
    const station = stations[i]
    return ring.map((p) => {
      // Wrap u twice across the ring so the paint texture reads the same on
      // both sides of the ship.
      const uCoord = station.u
      return b.vertex(station.x, p.y, p.z, uCoord, paintV(hull, station.u, p.y))
    })
  })

  // Wound so the face normal points out of the hull on both sides: the ring
  // runs down the port side and up the starboard side, so the sign of the
  // height step flips with it and the outward normal follows.
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < ringSize - 1; j++) {
      b.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
    }
  }

  // Transom at the stern and a narrow closing face at the stem.
  for (const end of [0, stations.length - 1] as const) {
    const ring = rings[end]
    const station = stations[end]
    const cz = ring.reduce((s, p) => s + p.z, 0) / ring.length
    const cy = ring.reduce((s, p) => s + p.y, 0) / ring.length
    const centre = b.vertex(station.x, cy, cz, station.u, paintV(hull, station.u, cy))
    for (let j = 0; j < ring.length - 1; j++) {
      const a = grid[end][j]
      const c = grid[end][j + 1]
      if (end === 0) b.triangle(centre, c, a)
      else b.triangle(centre, a, c)
    }
    // Close the ring across the deck opening.
    if (end === 0) b.triangle(centre, grid[end][0], grid[end][ring.length - 1])
    else b.triangle(centre, grid[end][ring.length - 1], grid[end][0])
  }

  return b.finish()
}

function buildDeck(hull: Hull): MeshData {
  const b = new MeshBuilder()
  const rows: [number, number][] = []
  for (const station of hull.stations) {
    const y = deckYAtU(hull, hull.weatherDeckY, station.u)
    const w = Math.max(0, halfBreadthAt(hull, station.u, y) - BULWARK_THICKNESS)
    const port = b.vertex(station.x, y, -w, station.u, 0)
    const starboard = b.vertex(station.x, y, w, station.u, 1)
    rows.push([port, starboard])
  }
  for (let i = 0; i < rows.length - 1; i++) {
    b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0])
  }
  return b.finish()
}

/** Inboard face of the bulwark plus the flat rail cap along the top. */
function buildBulwark(hull: Hull): MeshData {
  const b = new MeshBuilder()
  const inner: [number, number][] = []
  const capInner: number[] = []
  const capOuter: number[] = []

  for (const station of hull.stations) {
    const deck = deckYAtU(hull, hull.weatherDeckY, station.u)
    const rail = station.railY
    const deckHalf = Math.max(0, halfBreadthAt(hull, station.u, deck) - BULWARK_THICKNESS)
    const railHalf = Math.max(0, station.half[station.half.length - 1].z)
    const railInner = Math.max(0, railHalf - BULWARK_THICKNESS)

    inner.push([
      b.vertex(station.x, deck, -deckHalf, station.u, 0),
      b.vertex(station.x, rail, -railInner, station.u, 1),
    ])
    inner.push([
      b.vertex(station.x, deck, deckHalf, station.u, 0),
      b.vertex(station.x, rail, railInner, station.u, 1),
    ])
    capInner.push(
      b.vertex(station.x, rail, -railInner, station.u, 0),
      b.vertex(station.x, rail, railInner, station.u, 0),
    )
    capOuter.push(
      b.vertex(station.x, rail, -railHalf, station.u, 1),
      b.vertex(station.x, rail, railHalf, station.u, 1),
    )
  }

  const perStation = 2
  for (let i = 0; i < hull.stations.length - 1; i++) {
    const p0 = inner[i * perStation]
    const p1 = inner[(i + 1) * perStation]
    const s0 = inner[i * perStation + 1]
    const s1 = inner[(i + 1) * perStation + 1]
    // Port face looks to starboard, starboard face looks to port.
    b.quad(p0[0], p0[1], p1[1], p1[0])
    b.quad(s0[1], s0[0], s1[0], s1[1])

    const ci = i * 2
    const ni = (i + 1) * 2
    b.quad(capOuter[ci], capInner[ci], capInner[ni], capOuter[ni])
    b.quad(capInner[ci + 1], capOuter[ci + 1], capOuter[ni + 1], capInner[ni + 1])
  }

  return b.finish()
}

export function loftHull(hull: Hull): LoftedHull {
  return {
    shell: buildShell(hull),
    deck: buildDeck(hull),
    bulwark: buildBulwark(hull),
  }
}
