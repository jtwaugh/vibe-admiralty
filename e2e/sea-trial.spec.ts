import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { handSails, launch, openGroup, openPreset, readHud, setWind } from './demo'

/**
 * ACCEPTANCE section C, the sea trial rows: launching, keeping the design
 * across the launch and back, and the sails taking about two seconds to set.
 */

/** How much of the canvas differs between two shots, 0..1. */
async function frameDifference(page: Page, before: Buffer): Promise<number> {
  const after = await page.getByTestId('viewer-canvas').screenshot()
  const size = Math.min(before.length, after.length)
  let differing = 0
  // PNG bytes are compressed, so this compares the encoded streams: identical
  // frames encode identically, and a changing sail changes a great many bytes.
  for (let i = 0; i < size; i++) if (before[i] !== after[i]) differing++
  return differing / size
}

test('launch opens the sea trial and return to dock brings the design back', async ({
  page,
}) => {
  await openPreset(page, 'frigate-38')
  await page.getByTestId('ship-name').fill('HMS Trial')
  await openGroup(page, 'timber')
  await page.getByTestId('select-species').selectOption('live-oak')
  await page.waitForTimeout(300)
  const cost = await page.getByTestId('stat-cost').innerText()
  const displacement = await page.getByTestId('stat-displacement').innerText()

  await launch(page)
  await expect(page.getByTestId('trial-hud')).toBeVisible()
  await expect(page.getByTestId('sea-trial')).toContainText('HMS Trial')

  await page.getByTestId('btn-return').click()
  await expect(page.getByTestId('designer')).toBeVisible()
  await expect(page.getByTestId('ship-name')).toHaveValue('HMS Trial')
  expect(await page.getByTestId('stat-cost').innerText()).toBe(cost)
  expect(await page.getByTestId('stat-displacement').innerText()).toBe(displacement)
  // The mount she was armed with is still there, and still clickable.
  await expect(page.getByTestId('mount-row-battery-deck-0')).toContainText('14 / 14')
})

test('the crew take about two seconds to set a sail', async ({ page }) => {
  await openPreset(page, 'frigate-38')
  await launch(page)
  await setWind(page, 12, 270)

  const canvas = page.getByTestId('viewer-canvas')
  const furled = await canvas.screenshot()
  await handSails(page, 'courses', true)

  // Part way through the courses are half out of their bundles: the picture has
  // moved, but it is not where it finishes either.
  await page.waitForTimeout(900)
  const halfway = await canvas.screenshot()
  expect(await frameDifference(page, furled)).toBeGreaterThan(0.05)

  await page.waitForTimeout(2500)
  expect(await frameDifference(page, halfway)).toBeGreaterThan(0.05)
  await expect(page.getByTestId('sail-courses')).toHaveAttribute('aria-pressed', 'true')
})

test('setting sail in a beam wind lays her over and drives her forward', async ({
  page,
}) => {
  await openPreset(page, 'frigate-38')
  await launch(page)
  await setWind(page, 18, 270)
  await page.waitForTimeout(1500)

  const still = await readHud(page)
  expect(still.speed).toBeLessThan(0.6)
  expect(still.heel).toBeLessThan(0.6)

  await handSails(page, 'courses', true)
  await handSails(page, 'topsails', true)
  await page.waitForTimeout(14_000)

  const sailing = await readHud(page)
  expect(sailing.speed).toBeGreaterThan(2)
  expect(sailing.heel).toBeGreaterThan(1)
  // Wind out of the port side lays her over to starboard, never to windward.
  expect(sailing.heelText).toContain('to starboard')

  // Taking the canvas off her stands her back up.
  await handSails(page, 'courses', false)
  await handSails(page, 'topsails', false)
  await page.waitForTimeout(7000)
  expect((await readHud(page)).heel).toBeLessThan(sailing.heel)
})

test('the helm answers, and the wind dial turns the weather round', async ({ page }) => {
  await openPreset(page, 'frigate-38')
  await launch(page)
  await setWind(page, 18, 270)
  await page.getByTestId('sails-all-set').click()
  await page.waitForTimeout(12_000)
  const before = await readHud(page)

  await page.getByTestId('tiller').evaluate((element) => {
    const input = element as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '1')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.getByTestId('tiller-value')).toContainText('to starboard')
  await page.waitForTimeout(12_000)
  expect(await readHud(page)).not.toEqual(before)
  expect((await readHud(page)).heading).not.toBe(before.heading)

  await page.getByTestId('tiller-centre').click()
  await expect(page.getByTestId('tiller-value')).toContainText('amidships')
})

test('an over-canvased sloop with no stability goes over on her own', async ({ page }) => {
  await openPreset(page, 'sloop')
  await page.getByTestId('slider-beam').evaluate((element) => {
    const input = element as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '6.6')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await openGroup(page, 'rig')
  await page.getByTestId('select-sailplan').selectOption('over-canvased')
  await page.getByTestId('mount-row-battery-deck-0').click()
  await page.getByTestId('gun-long-32').click()
  await page.getByTestId('mount-close').click()
  await page.waitForTimeout(500)

  // The dock already tells the story.
  await expect(page.getByTestId('stats-warning')).toBeVisible()

  await launch(page)
  await setWind(page, 25, 270)
  await page.getByTestId('sails-all-set').click()
  await page.waitForTimeout(18_000)

  const hud = await readHud(page)
  expect(hud.heel).toBeGreaterThan(60)
  await expect(page.getByTestId('trial-notice')).toContainText('over')
})
