import * as THREE from 'three'
import type { SailInstance } from '../physics/sailplan'
import type { SailState } from '../export/schema'

/**
 * Sail geometry. Every sail is a flat panel with a bulge driven by one billow
 * parameter, so the same builder serves the still designer view and the live
 * sea trial: nothing here simulates cloth (SPEC §7).
 *
 * Sails are built in mast-local coordinates: +x forward, +y up, +z starboard.
 */

/** How far a set sail bellies out, as a fraction of its width. */
const BILLOW_DEPTH = 0.17

function bulge(across: number, up: number, billow: number, width: number): number {
  // Zero at the bolt ropes on either side and at the head and foot, greatest in
  // the middle of the cloth, which is how a full sail reads from any angle.
  return billow * width * BILLOW_DEPTH * Math.cos(across * Math.PI * 0.5) * Math.sin(up * Math.PI)
}

/**
 * A square sail hanging from a yard: spans athwartships, bellies forward.
 * The origin sits at the middle of the yard.
 */
export function squareSailGeometry(
  width: number,
  height: number,
  billow: number,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 10, 6)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const across = (2 * x) / width
    const up = (y + height / 2) / height
    // The foot of a set sail is drawn aft and up a little by the sheets.
    const scoop = billow * height * 0.06 * Math.pow(1 - up, 2) * (1 - Math.abs(across))
    position.setY(i, y + scoop)
    position.setZ(i, bulge(across, up, billow, width))
  }
  // The plane is built in XY; stand it up across the ship so the belly is forward.
  geometry.rotateY(Math.PI / 2)
  geometry.translate(0, -height / 2, 0)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * How thick a sail rolls up. A course furls to a bundle about a metre through;
 * a topgallant to a good deal less. Bounded so no sail becomes a log.
 */
export function bundleRadius(areaM2: number): number {
  return Math.min(0.5, Math.max(0.15, 0.032 * Math.sqrt(areaM2)))
}

/** A furled sail: canvas rolled up and gasketed along its yard. */
export function furledBundleGeometry(span: number, thickness: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(thickness, thickness, span, 7, 1)
  geometry.rotateX(Math.PI / 2)
  return geometry
}

/**
 * A fore-and-aft sail from its corners, in the ship's centreline plane, with
 * the same billow rule applied across the panel.
 */
export function foreAndAftSailGeometry(
  corners: { x: number; y: number }[],
  billow: number,
): THREE.BufferGeometry {
  const steps = 6
  const positions: number[] = []
  const indices: number[] = []
  // Corners run head/peak first, clockwise. Interpolate a grid between the two
  // edges that share the head, which covers both the triangle and the quad.
  const [a, b, c, d] = corners.length === 3 ? [corners[0], corners[1], corners[2], corners[0]] : corners
  const width = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x))
  for (let i = 0; i <= steps; i++) {
    const s = i / steps
    const top = { x: a.x + (d.x - a.x) * s, y: a.y + (d.y - a.y) * s }
    const bottom = { x: b.x + (c.x - b.x) * s, y: b.y + (c.y - b.y) * s }
    for (let j = 0; j <= steps; j++) {
      const t = j / steps
      const x = top.x + (bottom.x - top.x) * t
      const y = top.y + (bottom.y - top.y) * t
      positions.push(x, y, bulge(2 * s - 1, 1 - t, billow, width))
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const k = i * (steps + 1) + j
      indices.push(k, k + 1, k + steps + 1, k + 1, k + steps + 2, k + steps + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export type SailGeometry = {
  geometry: THREE.BufferGeometry
  /** Position of the mesh in mast-local coordinates. */
  position: THREE.Vector3
}

/**
 * Geometry for one sail in a given state. `billow` is how hard the wind is on
 * the cloth, 0..1; the sea trial animates it, the designer leaves it at rest.
 */
export function buildSailGeometry(
  sail: SailInstance,
  mastX: number,
  mastStepY: number,
  state: SailState,
  billow = 0.55,
): SailGeometry {
  const rolled = bundleRadius(sail.areaM2)
  const square = sail.tier !== 'jib' && sail.tier !== 'spanker'
  if (square) {
    const width = sail.yardHalfSpan * 2
    const height = sail.areaM2 / Math.max(1, width)
    if (state === 'set') {
      return {
        geometry: squareSailGeometry(width, height, billow),
        position: new THREE.Vector3(0, sail.yardY - mastStepY, 0),
      }
    }
    // The roll is gathered towards the middle of its yard and gasketed under
    // it, not run out to the yardarms.
    return {
      geometry: furledBundleGeometry(width * 0.72, rolled),
      position: new THREE.Vector3(0, sail.yardY - mastStepY - rolled * 1.3, 0),
    }
  }

  // Fore-and-aft sails are laid out on the rig by the sail plan; the mesh only
  // has to move them into the mast's frame.
  const corners = sail.corners.map((corner) => ({ x: corner.x - mastX, y: corner.y }))
  if (state === 'set') {
    return {
      geometry: foreAndAftSailGeometry(corners, billow),
      position: new THREE.Vector3(0, -mastStepY, 0),
    }
  }
  // Furled: a jib is stowed up its own stay, a spanker brailed along its boom.
  const [from, to] =
    sail.tier === 'jib' ? [corners[0], corners[2]] : [corners[1], corners[2]]
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  // A fore-and-aft sail stows along a stay or a boom and hands tighter than a
  // square sail gathered on its yard.
  const slim = rolled * 0.62
  const bundle = new THREE.CylinderGeometry(slim, slim, length, 7, 1)
  bundle.rotateZ(Math.PI / 2 + Math.atan2(to.y - from.y, to.x - from.x))
  return {
    geometry: bundle,
    position: new THREE.Vector3(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2 - mastStepY,
      0,
    ),
  }
}
