import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { hullAspect, hullWidth, mastLean, orbitBy, readSilhouette } from './silhouette'

/**
 * ACCEPTANCE section C, the designer half. The sea trial rows (launch and sail
 * animation) arrive with phase 3.
 */

const PRESETS = ['sloop', 'brig', 'frigate-28', 'frigate-38', 'third-rate-74']

async function openFrigate(page: Page) {
  await page.goto('/')
  await page.getByTestId('preset-frigate-38').click()
  await expect(page.getByTestId('designer')).toBeVisible()
  await page.waitForTimeout(400)
}

/** Panel groups start collapsed; a user opens the one they want first. */
async function openGroup(page: Page, name: string) {
  const group = page.getByTestId(`group-${name}`)
  const open = await group.evaluate((element) => (element as HTMLDetailsElement).open)
  if (!open) await group.locator('summary').click()
}

function numberIn(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ''))
}

async function statValue(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).innerText()).replace(/\s+/g, ' ')
}

/** Set a range input and fire the events React listens for. */
async function setSlider(page: Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate((element, target) => {
    const input = element as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!
    setter.call(input, String(target))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await page.waitForTimeout(350)
}

test('hull select shows five presets with rendered thumbnails', async ({ page }) => {
  await page.goto('/')
  for (const id of PRESETS) {
    await expect(page.getByTestId(`preset-${id}`)).toBeVisible()
    const source = await page.getByTestId(`preset-thumb-${id}`).getAttribute('src')
    expect(source).toMatch(/^data:image\/png/)
  }
  await page.getByTestId('preset-frigate-38').click()
  await expect(page.getByTestId('designer')).toBeVisible()
  await expect(page.getByTestId('ship-name')).toHaveValue('HMS Frigate (38)')
})

test('back to hulls returns to the menu', async ({ page }) => {
  await openFrigate(page)
  await page.getByTestId('btn-back').click()
  await expect(page.getByTestId('hull-select')).toBeVisible()
})

test('the beam slider widens the rendered hull and moves the displacement', async ({
  page,
}) => {
  await openFrigate(page)

  // Width is measured bow-on against the same ship seen broadside, so the
  // measurement does not depend on how far off the camera happens to be.
  const measure = async () => {
    await page.waitForTimeout(300)
    const broadside = hullWidth(await readSilhouette(page))
    await page.getByTestId('camera-toggle').click()
    await page.waitForTimeout(300)
    await orbitBy(page, -145)
    const bowOn = hullWidth(await readSilhouette(page))
    await page.getByTestId('camera-toggle').click()
    await page.waitForTimeout(300)
    return { broadside, bowOn, ratio: bowOn / broadside }
  }

  await setSlider(page, 'slider-beam', 10.2)
  const narrow = await measure()
  const narrowDisplacement = numberIn(await statValue(page, 'stat-displacement'))

  await setSlider(page, 'slider-beam', 14.8)
  const wide = await measure()
  const wideDisplacement = numberIn(await statValue(page, 'stat-displacement'))

  // Bow-on really is bow-on: she is far narrower than she is long.
  expect(narrow.bowOn).toBeLessThan(narrow.broadside * 0.6)
  expect(wide.ratio).toBeGreaterThan(narrow.ratio * 1.15)
  expect(wideDisplacement).toBeGreaterThan(narrowDisplacement)
})

test('the length slider stretches the rendered hull and moves the displacement', async ({
  page,
}) => {
  await openFrigate(page)

  // Measured broadside as a proportion, not a width: the viewer refits the
  // camera to the ship's length, so a longer hull is drawn at about the same
  // pixel length with a shorter-looking rig around it.
  const measure = async () => {
    await page.waitForTimeout(300)
    return hullAspect(await readSilhouette(page))
  }

  await setSlider(page, 'slider-length', 39)
  const shortAspect = await measure()
  const shortDisplacement = numberIn(await statValue(page, 'stat-displacement'))

  await setSlider(page, 'slider-length', 55)
  const longAspect = await measure()
  const longDisplacement = numberIn(await statValue(page, 'stat-displacement'))

  expect(longAspect).toBeGreaterThan(shortAspect * 1.1)
  expect(longDisplacement).toBeGreaterThan(shortDisplacement)
})

test('the depth of hold slider deepens the draught readout', async ({ page }) => {
  await openFrigate(page)

  await setSlider(page, 'slider-depth', 5.8)
  const shallow = numberIn(await statValue(page, 'stat-draft'))

  await setSlider(page, 'slider-depth', 8.6)
  const deep = numberIn(await statValue(page, 'stat-draft'))

  expect(deep).toBeGreaterThan(shallow)
})

test('the quarterdeck mount opens from the hull marker and arms with carronades', async ({
  page,
}) => {
  await openFrigate(page)
  const canvasBefore = await page
    .getByTestId('viewer-canvas')
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL())

  await page.getByTestId('mount-marker-quarterdeck').click()
  await expect(page.getByTestId('mount-modal')).toBeVisible()
  await expect(page.getByTestId('mount-modal')).toContainText('Quarterdeck battery')

  const broadsideBefore = await statValue(page, 'stat-broadside')
  await page.getByTestId('gun-carronade-32').click()
  await page.getByTestId('mount-close').click()
  await page.waitForTimeout(400)

  expect(await statValue(page, 'stat-broadside')).not.toBe(broadsideBefore)
  const canvasAfter = await page
    .getByTestId('viewer-canvas')
    .evaluate((c) => (c as HTMLCanvasElement).toDataURL())
  expect(canvasAfter).not.toBe(canvasBefore)
})

test('port and starboard counts are independent, and match sides syncs them', async ({
  page,
}) => {
  await openFrigate(page)
  await page.getByTestId('mount-row-quarterdeck').click()
  await page.getByTestId('mount-match').uncheck()

  await page.getByTestId('mount-starboard-less').click()
  await page.getByTestId('mount-starboard-less').click()
  await expect(page.getByTestId('mount-port')).toHaveText('4')
  await expect(page.getByTestId('mount-starboard')).toHaveText('2')

  await page.getByTestId('mount-match').check()
  await expect(page.getByTestId('mount-starboard')).toHaveText('4')
  await page.getByTestId('mount-port-less').click()
  await expect(page.getByTestId('mount-starboard')).toHaveText('3')
})

test('a port-only battery gives a static list and a visible heel', async ({ page }) => {
  await openFrigate(page)
  await page.getByTestId('camera-toggle').click()
  await page.waitForTimeout(400)
  // Turn the orbit camera down the ship's length, where a list shows as a lean.
  await orbitBy(page, -145)
  const upright = mastLean(await readSilhouette(page))
  await expect(page.getByTestId('stat-list')).toContainText('upright')

  for (const id of ['battery-deck-0', 'quarterdeck', 'forecastle']) {
    await page.getByTestId(`mount-row-${id}`).click()
    await page.getByTestId('mount-match').uncheck()
    const starboard = page.getByTestId('mount-starboard')
    while (Number(await starboard.innerText()) > 0) {
      await page.getByTestId('mount-starboard-less').click()
    }
    await page.getByTestId('mount-close').click()
  }
  await page.waitForTimeout(500)

  const list = page.getByTestId('stat-list')
  await expect(list).toContainText('to port')
  expect(numberIn((await list.innerText()).split('\n')[1] ?? '0')).toBeGreaterThan(0.5)
  await expect(page.getByTestId('stats-warning')).toBeVisible()

  const listed = mastLean(await readSilhouette(page))
  expect(Math.abs(listed - upright)).toBeGreaterThan(12)
})

test('the cost readout follows timber, ordnance and copper', async ({ page }) => {
  await openFrigate(page)
  await openGroup(page, 'timber')
  await openGroup(page, 'copper')
  const cost = () => statValue(page, 'stat-cost').then(numberIn)
  const start = await cost()

  await page.getByTestId('select-species').selectOption('live-oak')
  await page.waitForTimeout(300)
  const oak = await cost()
  expect(oak).toBeGreaterThan(start)

  await page.getByTestId('toggle-copper').check()
  await page.waitForTimeout(300)
  const coppered = await cost()
  expect(coppered).toBeGreaterThan(oak)

  await page.getByTestId('mount-row-battery-deck-0').click()
  await page.getByTestId('gun-long-24').click()
  await page.getByTestId('mount-close').click()
  await page.waitForTimeout(300)
  expect(await cost()).toBeGreaterThan(coppered)
})

test('live oak displaces more than Baltic fir', async ({ page }) => {
  await openFrigate(page)
  await openGroup(page, 'timber')
  await page.getByTestId('select-species').selectOption('baltic-fir')
  await page.waitForTimeout(300)
  const fir = numberIn(await statValue(page, 'stat-displacement'))
  await page.getByTestId('select-species').selectOption('live-oak')
  await page.waitForTimeout(300)
  expect(numberIn(await statValue(page, 'stat-displacement'))).toBeGreaterThan(fir)
})

test('export JSON downloads a document that parses', async ({ page }) => {
  await openFrigate(page)
  await page.getByTestId('ship-name').fill('HMS Surprise')
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('btn-export-json').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('hms-surprise.shipwright.json')
  const path = await download.path()
  const document = JSON.parse(readFileSync(path, 'utf8'))
  expect(document.schemaVersion).toBe(1)
  expect(document.name).toBe('HMS Surprise')
  expect(document.hull.presetId).toBe('frigate-38')
  expect(document.derived.displacementTonnes).toBeGreaterThan(100)
  expect(document.stations.length).toBeGreaterThan(5)
  expect(document.mounts['battery-deck-0'].port).toBe(14)
})

test('importing an exported design restores it exactly', async ({ page }) => {
  await openFrigate(page)
  await page.getByTestId('ship-name').fill('HMS Round Trip')
  await openGroup(page, 'timber')
  await page.getByTestId('select-species').selectOption('live-oak')
  await page.getByTestId('mount-row-forecastle').click()
  await page.getByTestId('mount-match').uncheck()
  await page.getByTestId('mount-port-less').click()
  await page.getByTestId('mount-close').click()
  await page.waitForTimeout(300)
  const before = await statValue(page, 'stat-cost')

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('btn-export-json').click()
  const path = (await (await downloadPromise).path())!

  await page.getByTestId('btn-back').click()
  await page.getByTestId('preset-sloop').click()
  await page.waitForTimeout(300)
  await page.getByTestId('import-file').setInputFiles(path)
  await page.waitForTimeout(600)

  await expect(page.getByTestId('ship-name')).toHaveValue('HMS Round Trip')
  expect(await statValue(page, 'stat-cost')).toBe(before)
})

test('export glTF downloads a model with the contract node names', async ({ page }) => {
  await openFrigate(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('btn-export-gltf').click()
  const download = await downloadPromise
  const gltf = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  const names = gltf.nodes.map((node: { name?: string }) => node.name)
  expect(names).toContain('Hull')
  expect(names).toContain('Mast_1')
  expect(names).toContain('Rudder')
  expect(names.some((name: string) => name?.startsWith('Sail_'))).toBe(true)
})
