import * as THREE from 'three'
import { cosmeticsFile, getSpecies } from '../data'
import type { Hull } from '../hull/stations'
import { deckYAtU, hullDepth } from '../hull/stations'
import type { ShipModel } from '../physics/masses'

const PAINT_WIDTH = 1024
const PAINT_HEIGHT = 512

export type PaintOptions = {
  hull: Hull
  model: ShipModel
  /** Height of the load waterline above the baseline. */
  waterlineY: number
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** Canvas row for a paint-space v coordinate; v = 0 is the keel, 1 the rail. */
function rowFor(v: number): number {
  return (1 - v) * PAINT_HEIGHT
}

/**
 * The hull's paint scheme drawn into a texture: bottom paint or copper below
 * the waterline, the wale, the painted strakes, and gunport lids. Drawing it
 * rather than colouring vertices keeps the strakes crisp, and the shell's v
 * coordinate already follows the sheer so the stripes curve with the ship.
 */
export function createPaintTexture(options: PaintOptions): THREE.CanvasTexture {
  const { hull, model, waterlineY } = options
  const scheme =
    cosmeticsFile.paintSchemes.find((p) => p.id === model.design.cosmetics.paintSchemeId) ??
    cosmeticsFile.paintSchemes[0]
  const depth = hullDepth(hull.params)
  const canvas = makeCanvas(PAINT_WIDTH, PAINT_HEIGHT)
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = scheme.hullColor
  ctx.fillRect(0, 0, PAINT_WIDTH, PAINT_HEIGHT)

  // Below the waterline: copper sheathing, or white stuff over the planking.
  const waterV = waterlineY / depth
  ctx.fillStyle = model.design.cosmetics.copperSheathing ? '#9a5a33' : '#8e8878'
  ctx.fillRect(0, rowFor(waterV), PAINT_WIDTH, PAINT_HEIGHT - rowFor(waterV))
  if (model.design.cosmetics.copperSheathing) {
    // Faint plate seams so the copper reads as sheet, not paint.
    ctx.strokeStyle = 'rgba(0,0,0,0.14)'
    ctx.lineWidth = 1
    for (let x = 0; x < PAINT_WIDTH; x += 26) {
      ctx.beginPath()
      ctx.moveTo(x, rowFor(waterV))
      ctx.lineTo(x, PAINT_HEIGHT)
      ctx.stroke()
    }
  }

  // The wale: a broad dark band of thick strakes at the waterline.
  const waleTop = rowFor((0.94 * hull.params.depthOfHold) / depth)
  const waleBottom = rowFor((0.62 * hull.params.depthOfHold) / depth)
  ctx.fillStyle = '#171512'
  ctx.fillRect(0, waleTop, PAINT_WIDTH, waleBottom - waleTop)

  // A painted strake at each armed deck, with gunport lids drawn on it.
  const stripeDecks = hull.decks.slice(0, Math.max(1, scheme.stripes ? hull.decks.length : 0))
  if (scheme.stripes > 0) {
    for (const deck of stripeDecks) {
      const bottomV = (deck.y + 0.25) / depth
      const topV = (deck.y + 1.75) / depth
      ctx.fillStyle = scheme.stripeColor
      ctx.fillRect(0, rowFor(topV), PAINT_WIDTH, rowFor(bottomV) - rowFor(topV))
    }
  }

  // Gunport lids: black squares on the strake, at the socket positions.
  ctx.fillStyle = '#141210'
  for (const socket of model.sockets.mounts) {
    if (socket.kind !== 'battery') continue
    const deck = hull.decks[socket.deckIndex]
    const sillV = (deck.y + 0.5) / depth
    const headV = (deck.y + 1.5) / depth
    const top = rowFor(headV)
    const height = rowFor(sillV) - top
    for (const position of socket.positions) {
      const u = position.x / hull.params.keelLength + 0.5
      const width = height * 0.95
      ctx.fillRect(u * PAINT_WIDTH - width / 2, top, width, height)
    }
  }

  // A thin light rail cap so the sheer line reads at a distance.
  ctx.fillStyle = '#c8b48c'
  ctx.fillRect(0, 0, PAINT_WIDTH, Math.max(2, PAINT_HEIGHT * 0.012))

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 8
  return texture
}

/** Scrubbed deck planking: pale timber with darker caulked seams. */
export function createDeckTexture(): THREE.CanvasTexture {
  const canvas = makeCanvas(256, 256)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c2a878'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = '#8d7752'
  ctx.lineWidth = 2
  for (let y = 0; y < 256; y += 16) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(256, y)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  for (let i = 0; i < 60; i++) {
    const x = (i * 97) % 256
    const y = (i * 53) % 256
    ctx.fillRect(x, y, 24, 3)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(18, 3)
  return texture
}

export type ShipMaterials = {
  hull: THREE.MeshStandardMaterial
  deck: THREE.MeshStandardMaterial
  bulwark: THREE.MeshStandardMaterial
  timber: THREE.MeshStandardMaterial
  iron: THREE.MeshStandardMaterial
  brass: THREE.MeshStandardMaterial
  rigging: THREE.LineBasicMaterial
  dispose(): void
}

export function createShipMaterials(options: PaintOptions): ShipMaterials {
  const paint = createPaintTexture(options)
  const deckTexture = createDeckTexture()
  const species = getSpecies(options.model.design.timber.speciesId)

  const hull = new THREE.MeshStandardMaterial({
    map: paint,
    roughness: 0.72,
    metalness: 0.02,
  })
  const deck = new THREE.MeshStandardMaterial({
    map: deckTexture,
    roughness: 0.85,
    metalness: 0,
  })
  const bulwark = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#8c3f2c'),
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const timber = new THREE.MeshStandardMaterial({
    color: new THREE.Color(species.color),
    roughness: 0.7,
    metalness: 0,
  })
  const iron = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2a2a2e'),
    roughness: 0.45,
    metalness: 0.75,
  })
  const brass = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b98a3c'),
    roughness: 0.35,
    metalness: 0.8,
  })
  const rigging = new THREE.LineBasicMaterial({
    color: new THREE.Color('#241d16'),
    transparent: true,
    opacity: 0.85,
  })

  return {
    hull,
    deck,
    bulwark,
    timber,
    iron,
    brass,
    rigging,
    dispose() {
      paint.dispose()
      deckTexture.dispose()
      for (const m of [hull, deck, bulwark, timber, iron, brass, rigging]) m.dispose()
    },
  }
}

/** Height of the weather deck at the bow, used to place the head rails. */
export function bowDeckY(hull: Hull): number {
  return deckYAtU(hull, hull.weatherDeckY, 0.95)
}
