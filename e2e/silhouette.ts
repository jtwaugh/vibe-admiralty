import type { Page } from '@playwright/test'

export type Silhouette = {
  width: number
  height: number
  /** Bounding box of everything that is not sky or sea. */
  box: { left: number; right: number; top: number; bottom: number } | null
  /** Left and right edge of the ship on each row, top to bottom. */
  rows: { y: number; left: number; right: number }[]
}

/**
 * Reads the ship's outline straight out of the rendered canvas. The sky is a
 * vertical gradient and the sea is flat, so on any given row the background is
 * the same colour all the way across: a pixel that differs from the row's left
 * edge is ship. This is how the tests check what was actually drawn rather than
 * what the state says.
 */
export async function readSilhouette(page: Page): Promise<Silhouette> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="viewer-canvas"]')
    if (!canvas) throw new Error('no viewer canvas')
    const off = document.createElement('canvas')
    off.width = canvas.width
    off.height = canvas.height
    const ctx = off.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, off.width, off.height)

    const rows: { y: number; left: number; right: number }[] = []
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity

    for (let y = 0; y < height; y++) {
      const base = y * width * 4
      const br = data[base]
      const bg = data[base + 1]
      const bb = data[base + 2]
      let rowLeft = -1
      let rowRight = -1
      for (let x = 0; x < width; x++) {
        const i = base + x * 4
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const delta = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb)
        if (delta <= 26) continue
        // The ship's shadow on the sea is the background colour turned down,
        // not a different colour. Scale the background to this pixel's
        // brightness: if it then matches, this is shaded water, not ship.
        const scale = g > 0 && bg > 0 ? g / bg : 1
        const shaded = Math.abs(r - br * scale) + Math.abs(b - bb * scale) < 14
        if (shaded) continue
        if (rowLeft < 0) rowLeft = x
        rowRight = x
      }
      if (rowLeft < 0) continue
      rows.push({ y, left: rowLeft, right: rowRight })
      left = Math.min(left, rowLeft)
      right = Math.max(right, rowRight)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }

    return {
      width,
      height,
      rows,
      box: rows.length > 0 ? { left, right, top, bottom } : null,
    }
  })
}

/**
 * Widest part of the bottom band of the silhouette, which is the hull: the
 * masts and yards are above it and would otherwise dominate the measurement.
 */
export function hullWidth(silhouette: Silhouette): number {
  const box = silhouette.box
  if (!box) return 0
  const bandTop = box.bottom - (box.bottom - box.top) * 0.16
  let widest = 0
  for (const row of silhouette.rows) {
    if (row.y < bandTop) continue
    widest = Math.max(widest, row.right - row.left)
  }
  return widest
}

/**
 * Width over height of the whole silhouette. The viewer reframes the camera to
 * fit the ship's length, so a stretched hull is drawn at about the same pixel
 * length and everything else shrinks around it: an absolute width would prove
 * nothing. A proportion survives the reframing, and since the rig's height is
 * set by beam rather than length, stretching her raises this number.
 */
export function hullAspect(silhouette: Silhouette): number {
  const box = silhouette.box
  if (!box || box.bottom === box.top) return 0
  return (box.right - box.left) / (box.bottom - box.top)
}

/**
 * How far the mastheads lean off the hull's centre, in pixels: her heel. Only
 * meaningful looking down the ship's length, where a list is a sideways tilt
 * rather than a rotation towards the camera.
 */
export function mastLean(silhouette: Silhouette): number {
  const box = silhouette.box
  if (!box) return 0
  const span = box.bottom - box.top
  const centreOf = (from: number, to: number) => {
    const rows = silhouette.rows.filter((row) => row.y >= from && row.y <= to)
    if (rows.length === 0) return 0
    return rows.reduce((sum, row) => sum + (row.left + row.right) / 2, 0) / rows.length
  }
  const masthead = centreOf(box.top, box.top + span * 0.1)
  const hull = centreOf(box.bottom - span * 0.14, box.bottom)
  return masthead - hull
}

/** Turn the orbit camera by dragging the canvas, as a user would. */
export async function orbitBy(page: Page, pixels: number) {
  const canvas = page.getByTestId('viewer-canvas')
  const box = (await canvas.boundingBox())!
  const y = box.y + box.height * 0.35
  const startX = box.x + box.width * 0.5
  await page.mouse.move(startX, y)
  await page.mouse.down()
  const steps = 12
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (pixels * i) / steps, y)
  }
  await page.mouse.up()
  await page.waitForTimeout(250)
}
