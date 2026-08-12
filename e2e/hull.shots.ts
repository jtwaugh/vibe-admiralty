import { expect, test } from '@playwright/test'
import { setSlider } from './demo'

/** Preset ids as the UI exposes them; e2e drives the app as a user would. */
const PRESET_IDS = ['sloop', 'brig', 'frigate-28', 'frigate-38', 'third-rate-74']

/**
 * The ends of the two hull sliders added alongside beam, freeboard and sheer.
 * Values are the frigate-38 preset's declared ranges.
 */
const SLIDER_ENDS = [
  { name: 'length-min', testId: 'slider-length', value: 39 },
  { name: 'length-max', testId: 'slider-length', value: 55 },
  { name: 'depth-min', testId: 'slider-depth', value: 5.8 },
  { name: 'depth-max', testId: 'slider-depth', value: 8.6 },
]

/**
 * Demo screenshots for looking at, per CLAUDE.md rule 2: the hull select
 * screen, one broadside profile per preset, and the designer at work.
 */
test.describe('gallery', () => {
  test('hull select', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('preset-thumb-third-rate-74')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'shots/hull-select.png', fullPage: true })
  })

  for (const presetId of PRESET_IDS) {
    test(`broadside profile: ${presetId}`, async ({ page }) => {
      await page.goto('/')
      await page.getByTestId(`preset-${presetId}`).click()
      await page.waitForTimeout(900)
      await expect(page.getByTestId('viewer-canvas')).toBeVisible()
      await page.screenshot({ path: `shots/profile-${presetId}.png` })
    })
  }

  test('orbit view: frigate-38', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('preset-frigate-38').click()
    await page.getByTestId('camera-toggle').click()
    await page.waitForTimeout(900)
    await page.screenshot({ path: 'shots/orbit-frigate-38.png' })
  })

  test('mount modal', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('preset-frigate-38').click()
    await page.getByTestId('mount-row-quarterdeck').click()
    await expect(page.getByTestId('mount-modal')).toBeVisible()
    await page.getByTestId('gun-carronade-32').click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'shots/mount-modal.png' })
  })

  // The pictures rule 2 asks for: is she still a ship at the ends of the two
  // new sliders? Gunports clear of the water, masts through the deck, the whole
  // hull in frame.
  for (const end of SLIDER_ENDS) {
    test(`hull slider extreme: ${end.name}`, async ({ page }) => {
      await page.goto('/')
      await page.getByTestId('preset-frigate-38').click()
      await expect(page.getByTestId('viewer-canvas')).toBeVisible()
      await setSlider(page, end.testId, end.value)
      await page.waitForTimeout(900)
      await page.screenshot({ path: `shots/slider-${end.name}.png` })
    })
  }

  test('the lopside: every battery to port', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('preset-frigate-38').click()
    for (const id of ['battery-deck-0', 'quarterdeck', 'forecastle']) {
      await page.getByTestId(`mount-row-${id}`).click()
      await page.getByTestId('mount-match').uncheck()
      const starboard = page.getByTestId('mount-starboard')
      while (Number(await starboard.innerText()) > 0) {
        await page.getByTestId('mount-starboard-less').click()
      }
      await page.getByTestId('mount-close').click()
    }
    await page.getByTestId('camera-toggle').click()
    await page.waitForTimeout(900)
    await page.screenshot({ path: 'shots/lopside-frigate-38.png' })
  })
})
