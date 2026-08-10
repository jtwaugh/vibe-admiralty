import * as THREE from 'three'
import { cosmeticsFile, getSpecies } from '../data'
import { GUNPORT_HEIGHT, GUNPORT_SILL_HEIGHT, GUNPORT_WIDTH } from '../hull/sockets'
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
export function createPaintTexture(options: PaintOptions): THREE.CanvasTexture | null {
  const { hull, model, waterlineY } = options
  const scheme =
    cosmeticsFile.paintSchemes.find((p) => p.id === model.design.cosmetics.paintSchemeId) ??
    cosmeticsFile.paintSchemes[0]
  const depth = hullDepth(hull.params)
  const canvas = makeCanvas(PAINT_WIDTH, PAINT_HEIGHT)
  const ctx = canvas.getContext('2d')
  // Headless environments (the glTF export test) have no 2d canvas; the caller
  // falls back to flat colour, which is all those runs need.
  if (!ctx) return null

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

  // Gunport lids: dark openings on the strake, at the socket positions. Width
  // comes from the real port width, not from the pixel height, because the
  // texture is stretched differently along the ship than up her side.
  const portWidthPx = (GUNPORT_WIDTH / hull.params.keelLength) * PAINT_WIDTH
  for (const socket of model.sockets.mounts) {
    if (socket.kind !== 'battery') continue
    const deck = hull.decks[socket.deckIndex]
    const top = rowFor((deck.y + GUNPORT_SILL_HEIGHT + GUNPORT_HEIGHT) / depth)
    const height = rowFor((deck.y + GUNPORT_SILL_HEIGHT) / depth) - top
    for (const position of socket.positions) {
      const u = position.x / hull.params.keelLength + 0.5
      const left = u * PAINT_WIDTH - portWidthPx / 2
      ctx.fillStyle = '#141210'
      ctx.fillRect(left, top, portWidthPx, height)
      // A lid hinged at the head, thrown up over the port.
      ctx.fillStyle = scheme.stripeColor
      ctx.fillRect(left, top - height * 0.16, portWidthPx, height * 0.16)
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 1
      ctx.strokeRect(left, top - height * 0.16, portWidthPx, height * 1.16)
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
export function createDeckTexture(): THREE.CanvasTexture | null {
  const canvas = makeCanvas(256, 256)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
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
  canvas: THREE.MeshStandardMaterial
  furledCanvas: THREE.MeshStandardMaterial
  gilding: THREE.MeshStandardMaterial
  glass: THREE.MeshStandardMaterial
  underwater: THREE.MeshStandardMaterial
  marker: THREE.MeshStandardMaterial
  markerActive: THREE.MeshStandardMaterial
  rigging: THREE.LineBasicMaterial
  dispose(): void
}

export function createShipMaterials(options: PaintOptions): ShipMaterials {
  const paint = createPaintTexture(options)
  const deckTexture = createDeckTexture()
  const species = getSpecies(options.model.design.timber.speciesId)
  const scheme =
    cosmeticsFile.paintSchemes.find(
      (p) => p.id === options.model.design.cosmetics.paintSchemeId,
    ) ?? cosmeticsFile.paintSchemes[0]

  const hull = new THREE.MeshStandardMaterial({
    map: paint,
    color: new THREE.Color(paint ? '#ffffff' : scheme.hullColor),
    roughness: 0.72,
    metalness: 0.02,
  })
  const deck = new THREE.MeshStandardMaterial({
    map: deckTexture,
    color: new THREE.Color(deckTexture ? '#ffffff' : '#c2a878'),
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
  // Sailcloth is thin: it is lit from both sides and shows through a little.
  const canvasCloth = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#e6dcc4'),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  })

  // Mount markers: a brass ring that reads against black topsides and pale sky
  // alike, and glows when its modal is open.
  const marker = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f0c268'),
    emissive: new THREE.Color('#7a4d12'),
    roughness: 0.35,
    metalness: 0.6,
    transparent: true,
    opacity: 0.92,
  })
  const markerActive = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fff3d0'),
    emissive: new THREE.Color('#c98a1e'),
    emissiveIntensity: 1.4,
    roughness: 0.3,
    metalness: 0.5,
    transparent: true,
    opacity: 0.98,
  })

  // Rolled canvas is a little duller than a sail drawing full, but it still has
  // to read as canvas against the sky.
  const furledCanvas = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cabfa4'),
    roughness: 1,
    metalness: 0,
  })
  // Gold leaf on the carved work: figurehead, gallery rails, taffrail.
  const gilding = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#d9ad4e'),
    roughness: 0.32,
    metalness: 0.7,
  })
  // Stern lights: dark glass with a little sheen.
  const glass = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#16242e'),
    roughness: 0.18,
    metalness: 0.25,
    side: THREE.DoubleSide,
  })
  // Anything below the waterline that is not the shell: rudder, keel shoe.
  const underwater = new THREE.MeshStandardMaterial({
    color: new THREE.Color(
      options.model.design.cosmetics.copperSheathing ? '#8b5230' : '#7d786a',
    ),
    roughness: 0.7,
    metalness: options.model.design.cosmetics.copperSheathing ? 0.35 : 0.05,
  })

  return {
    hull,
    deck,
    bulwark,
    timber,
    iron,
    brass,
    canvas: canvasCloth,
    furledCanvas,
    gilding,
    glass,
    underwater,
    marker,
    markerActive,
    rigging,
    dispose() {
      paint?.dispose()
      deckTexture?.dispose()
      const all = [
        hull,
        deck,
        bulwark,
        timber,
        iron,
        brass,
        canvasCloth,
        furledCanvas,
        gilding,
        glass,
        underwater,
        marker,
        markerActive,
        rigging,
      ]
      for (const m of all) m.dispose()
    },
  }
}

/** Height of the weather deck at the bow, used to place the head rails. */
export function bowDeckY(hull: Hull): number {
  return deckYAtU(hull, hull.weatherDeckY, 0.95)
}
