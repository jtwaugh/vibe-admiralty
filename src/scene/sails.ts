import * as THREE from 'three'
import type { SailInstance, SailPoint } from '../physics/sailplan'
import type { SailState } from '../export/schema'

/**
 * Sail geometry and the billow that drives it (SPEC §7). Nothing here simulates
 * cloth. Each sail is built flat, and carries with it the displacement that
 * takes it to a full belly; the sail material's vertex shader interpolates
 * between the two from one uniform, which the sea trial sets to the wind
 * pressure on that sail. A negative uniform bellies it the wrong way, which is
 * what a sail taken aback looks like.
 *
 * Sails are built in mast-local coordinates: +x forward, +y up, +z starboard.
 */

/** How far a full sail bellies out, as a fraction of its width. */
const BILLOW_DEPTH = 0.17

function bulge(across: number, up: number, width: number): number {
  // Zero at the bolt ropes on either side and at the head and foot, greatest in
  // the middle of the cloth, which is how a full sail reads from any angle.
  return width * BILLOW_DEPTH * Math.cos(across * Math.PI * 0.5) * Math.sin(up * Math.PI)
}

/**
 * Attach the billow to a geometry: how far each vertex moves when the sail
 * fills, and what that does to its normal. Storing the difference rather than
 * the gradients keeps the shader to two lines and is exact at both ends.
 */
function attachBillow(
  geometry: THREE.BufferGeometry,
  fullPositions: number[],
): THREE.BufferGeometry {
  const flat = geometry.attributes.position as THREE.BufferAttribute
  const flatNormals = geometry.attributes.normal as THREE.BufferAttribute

  const full = new THREE.BufferGeometry()
  full.setAttribute('position', new THREE.Float32BufferAttribute(fullPositions, 3))
  full.setIndex(geometry.getIndex())
  full.computeVertexNormals()
  const fullNormals = full.attributes.normal as THREE.BufferAttribute

  const count = flat.count
  const billow = new Float32Array(count * 3)
  const billowNormal = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    billow[i * 3] = fullPositions[i * 3] - flat.getX(i)
    billow[i * 3 + 1] = fullPositions[i * 3 + 1] - flat.getY(i)
    billow[i * 3 + 2] = fullPositions[i * 3 + 2] - flat.getZ(i)
    billowNormal[i * 3] = fullNormals.getX(i) - flatNormals.getX(i)
    billowNormal[i * 3 + 1] = fullNormals.getY(i) - flatNormals.getY(i)
    billowNormal[i * 3 + 2] = fullNormals.getZ(i) - flatNormals.getZ(i)
  }
  geometry.setAttribute('aBillow', new THREE.BufferAttribute(billow, 3))
  geometry.setAttribute('aBillowNormal', new THREE.BufferAttribute(billowNormal, 3))
  full.dispose()
  return geometry
}

const SQUARE_ACROSS = 10
const SQUARE_DOWN = 6

/**
 * A square sail hanging from a yard: it spans athwartships and bellies forward.
 * The origin sits at the middle of the yard, so scaling the mesh in y lowers
 * the sail from its spar, which is how one is loosed.
 */
export function squareSailGeometry(width: number, height: number): THREE.BufferGeometry {
  const flat: number[] = []
  const full: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= SQUARE_DOWN; j++) {
    // up runs 1 at the head down to 0 at the foot.
    const up = 1 - j / SQUARE_DOWN
    for (let i = 0; i <= SQUARE_ACROSS; i++) {
      const across = (2 * i) / SQUARE_ACROSS - 1
      const z = (across * width) / 2
      const y = -height * (1 - up)
      flat.push(0, y, z)
      // The foot of a full sail is drawn aft and up a little by the sheets.
      const scoop = height * 0.06 * Math.pow(up, 2) * (1 - Math.abs(across))
      full.push(bulge(across, up, width), y + scoop, z)
    }
  }
  for (let j = 0; j < SQUARE_DOWN; j++) {
    for (let i = 0; i < SQUARE_ACROSS; i++) {
      const k = j * (SQUARE_ACROSS + 1) + i
      indices.push(k, k + 1, k + SQUARE_ACROSS + 1)
      indices.push(k + 1, k + SQUARE_ACROSS + 2, k + SQUARE_ACROSS + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return attachBillow(geometry, full)
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

const FORE_AFT_STEPS = 6

/**
 * A fore-and-aft sail from its corners, in the ship's centreline plane, with
 * the same billow rule applied across the panel. It bellies athwartships.
 */
export function foreAndAftSailGeometry(corners: SailPoint[]): THREE.BufferGeometry {
  const steps = FORE_AFT_STEPS
  const flat: number[] = []
  const full: number[] = []
  const indices: number[] = []
  // Corners run head/peak first, clockwise. Interpolate a grid between the two
  // edges that share the head, which covers both the triangle and the quad.
  const [a, b, c, d] =
    corners.length === 3 ? [corners[0], corners[1], corners[2], corners[0]] : corners
  const width = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x))
  for (let i = 0; i <= steps; i++) {
    const s = i / steps
    const top = { x: a.x + (d.x - a.x) * s, y: a.y + (d.y - a.y) * s }
    const bottom = { x: b.x + (c.x - b.x) * s, y: b.y + (c.y - b.y) * s }
    for (let j = 0; j <= steps; j++) {
      const t = j / steps
      const x = top.x + (bottom.x - top.x) * t
      const y = top.y + (bottom.y - top.y) * t
      flat.push(x, y, 0)
      full.push(x, y, bulge(2 * s - 1, 1 - t, width))
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const k = i * (steps + 1) + j
      indices.push(k, k + 1, k + steps + 1, k + 1, k + steps + 2, k + steps + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return attachBillow(geometry, full)
}

export function isSquareSail(sail: SailInstance): boolean {
  return sail.tier !== 'jib' && sail.tier !== 'spanker'
}

/** Width and depth of a square sail's cloth, from its area and its yard. */
export function squareSailSize(sail: SailInstance): { width: number; height: number } {
  const width = sail.yardHalfSpan * 2
  return { width, height: sail.areaM2 / Math.max(1, width) }
}

/**
 * The corners of a fore-and-aft sail part way through being set. At 0 the cloth
 * is gathered on its stay or its boom; at 1 it is drawn out full. A jib is
 * hoisted head-first up the stay, a spanker hauled out along the boom.
 */
export function foreAndAftCorners(
  sail: SailInstance,
  mastX: number,
  hoist: number,
): SailPoint[] {
  const corners = sail.corners.map((corner) => ({ x: corner.x - mastX, y: corner.y }))
  const t = Math.max(0, Math.min(1, hoist))
  const lerp = (from: SailPoint, to: SailPoint): SailPoint => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  })
  if (sail.tier === 'jib') {
    // Head climbs the stay from the tack; the luff and foot follow it up.
    const tack = corners[2]
    return [lerp(tack, corners[0]), lerp(tack, corners[1]), tack]
  }
  // Peak and clew swing out from the mast along the gaff and boom.
  return [corners[0], corners[1], lerp(corners[1], corners[2]), lerp(corners[0], corners[3])]
}

export type SailShape = {
  geometry: THREE.BufferGeometry
  /** Position of the mesh in mast-local coordinates. */
  position: THREE.Vector3
}

/** The set cloth of one sail, drawn flat with its billow attached. */
export function buildSetSailGeometry(
  sail: SailInstance,
  mastX: number,
  mastStepY: number,
  hoist = 1,
): SailShape {
  if (isSquareSail(sail)) {
    const { width, height } = squareSailSize(sail)
    return {
      geometry: squareSailGeometry(width, height),
      position: new THREE.Vector3(0, sail.yardY - mastStepY, 0),
    }
  }
  return {
    geometry: foreAndAftSailGeometry(foreAndAftCorners(sail, mastX, hoist)),
    position: new THREE.Vector3(0, -mastStepY, 0),
  }
}

/** The same sail rolled up and gasketed, for when she is not carrying it. */
export function buildFurledSailGeometry(
  sail: SailInstance,
  mastX: number,
  mastStepY: number,
): SailShape {
  const rolled = bundleRadius(sail.areaM2)
  if (isSquareSail(sail)) {
    const { width } = squareSailSize(sail)
    // The roll is gathered towards the middle of its yard and gasketed under
    // it, not run out to the yardarms.
    return {
      geometry: furledBundleGeometry(width * 0.72, rolled),
      position: new THREE.Vector3(0, sail.yardY - mastStepY - rolled * 1.3, 0),
    }
  }
  const corners = sail.corners.map((corner) => ({ x: corner.x - mastX, y: corner.y }))
  // A jib is stowed up its own stay, a spanker brailed along its boom.
  const [from, to] = sail.tier === 'jib' ? [corners[0], corners[2]] : [corners[1], corners[2]]
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  // Fore-and-aft canvas hands tighter than a square sail gathered on its yard.
  const slim = rolled * (sail.tier === 'jib' ? 0.4 : 0.62)
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

/**
 * Geometry for one sail in a settled state, which is what the designer draws.
 * The sea trial uses the two builders above and animates between them.
 */
export function buildSailGeometry(
  sail: SailInstance,
  mastX: number,
  mastStepY: number,
  state: SailState,
): SailShape {
  return state === 'set'
    ? buildSetSailGeometry(sail, mastX, mastStepY)
    : buildFurledSailGeometry(sail, mastX, mastStepY)
}

/**
 * A sailcloth material whose vertex shader carries the billow. Every sail gets
 * its own, because the wind is not the same on all of them: the weather leeches
 * of the courses can be full while a topsail is shaking.
 */
export function createSailMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e8dfc8'),
    roughness: 0.95,
    metalness: 0,
    // Sailcloth is thin. The sun comes through it, so the shaded side of a sail
    // is never as dark as the shaded side of a plank: without this the whole
    // rig reads as sheets of grey card whenever the light is behind her.
    emissive: new THREE.Color('#6b6350'),
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
  })
  const uBillow = { value: 0 }
  material.userData.uBillow = uBillow
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBillow = uBillow
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aBillow;
        attribute vec3 aBillowNormal;
        uniform float uBillow;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        objectNormal = normalize(objectNormal + uBillow * aBillowNormal);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += uBillow * aBillow;`,
      )
  }
  // Without this every sail compiles its own program even though they share one.
  material.customProgramCacheKey = () => 'shipwright-sail'
  return material
}

/** Set the billow on a material made by createSailMaterial. */
export function setBillow(material: THREE.Material, billow: number) {
  const uniform = material.userData.uBillow as { value: number } | undefined
  if (uniform) uniform.value = billow
}
