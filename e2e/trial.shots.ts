import { test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  armMount,
  handSails,
  launch,
  loadPortOnly,
  openGroup,
  openPreset,
  orbitCamera,
  readHud,
  setSlider,
  setWind,
} from './demo'

/**
 * The two demo scripts of ACCEPTANCE D and E, as screenshots to be looked at.
 * Every one of these is driven through the real controls; what the ship does
 * afterwards is the physics' business.
 */

test.describe('demo one: the frigate', () => {
  test('a fair breeze on the beam', async ({ page }) => {
    await openPreset(page, 'frigate-38')
    await openGroup(page, 'copper')
    await page.getByTestId('toggle-copper').check()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'shots/trial-frigate-dock.png' })

    await launch(page)
    await setWind(page, 15, 270)
    await page.screenshot({ path: 'shots/trial-frigate-bare.png' })

    await handSails(page, 'courses', true)
    await handSails(page, 'topsails', true)
    // Two seconds to set, then long enough to gather way and settle.
    await page.waitForTimeout(1200)
    await page.screenshot({ path: 'shots/trial-frigate-making-sail.png' })

    await page.waitForTimeout(24_000)
    console.log('frigate under courses and topsails:', await readHud(page))
    await page.screenshot({ path: 'shots/trial-frigate-under-way.png' })

    await handSails(page, 'topsails', false)
    await page.waitForTimeout(6000)
    console.log('frigate with topsails furled:', await readHud(page))
    await page.screenshot({ path: 'shots/trial-frigate-topsails-furled.png' })
  })
})

/** Sloop, minimum beam, over-canvased, long 32s everywhere, heavy bulwarks. */
async function buildAbomination(page: Page, beam: number) {
  await openPreset(page, 'sloop')
  await setSlider(page, 'slider-beam', beam)
  await openGroup(page, 'timber')
  await page.getByTestId('select-species').selectOption('baltic-fir')
  await page.getByTestId('select-zone-bulwarks').selectOption('heavy')
  await openGroup(page, 'rig')
  await page.getByTestId('select-sailplan').selectOption('over-canvased')
  for (const mount of ['battery-deck-0', 'bow-chaser', 'stern-chaser']) {
    await armMount(page, mount, 'long-32')
  }
  await page.waitForTimeout(500)
}

test.describe('demo two: the abomination', () => {
  test('she goes over', async ({ page }) => {
    await buildAbomination(page, 6.6)
    await page.screenshot({ path: 'shots/abomination-dock.png' })

    await launch(page)
    await setWind(page, 25, 270)
    await page.screenshot({ path: 'shots/abomination-launch.png' })

    await handSails(page, 'courses', true)
    await handSails(page, 'topsails', true)
    await handSails(page, 'topgallants', true)
    await handSails(page, 'jibs', true)

    // The whole business is over in a few seconds, so this is shot as a strip.
    for (const [index, wait] of [1200, 1200, 1400, 2500, 4000, 3500].entries()) {
      await page.waitForTimeout(wait)
      await page.screenshot({ path: `shots/abomination-over-${index + 1}.png` })
    }
    console.log('abomination:', await readHud(page))
  })

  test('at full beam she survives, and wallows', async ({ page }) => {
    await buildAbomination(page, 11.2)
    await page.screenshot({ path: 'shots/wallow-dock.png' })

    await launch(page)
    await setWind(page, 25, 270)
    await page.getByTestId('sails-all-set').click()
    await page.waitForTimeout(20_000)
    console.log('wallow, under all sail:', await readHud(page))
    await page.screenshot({ path: 'shots/wallow-under-way.png' })

    // Hard over, to show how long she takes to come round.
    await setSlider(page, 'tiller', 1)
    await page.waitForTimeout(20_000)
    console.log('wallow, hard over for 20 s:', await readHud(page))
    await page.screenshot({ path: 'shots/wallow-turning.png' })
  })
})

test.describe('demo two, variant three: the lopside', () => {
  test('every battery to port', async ({ page }) => {
    await openPreset(page, 'frigate-38')
    for (const mount of ['battery-deck-0', 'quarterdeck', 'forecastle']) {
      await loadPortOnly(page, mount)
    }
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'shots/lopside-dock.png' })

    await launch(page)
    // Round to her port side, which is the one she is lying on: from the high
    // side a list hides itself and the lee gunports cannot be seen at all.
    await orbitCamera(page, -524)
    // Calm first, so the list she carries is her own and nothing else.
    await setWind(page, 0, 90)
    await page.waitForTimeout(9000)
    console.log('lopside in calm water:', await readHud(page))
    await page.screenshot({ path: 'shots/lopside-calm.png' })

    // Now the wind on the side she is already down.
    await page.getByTestId('sails-all-set').click()
    await setWind(page, 20, 90)
    await page.waitForTimeout(22_000)
    console.log('lopside under 20 kn:', await readHud(page))
    await page.screenshot({ path: 'shots/lopside-20kn.png' })

    // A squall hard enough to put her lee ports under, which is what finishes
    // her: see DECISIONS.md on why twenty knots does not.
    await setWind(page, 50, 90)
    for (const [index, wait] of [6000, 6000, 8000, 10_000].entries()) {
      await page.waitForTimeout(wait)
      await page.screenshot({ path: `shots/lopside-squall-${index + 1}.png` })
    }
    console.log('lopside in the squall:', await readHud(page))
  })
})
