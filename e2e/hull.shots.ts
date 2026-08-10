import { expect, test } from '@playwright/test'
/** Preset ids as the UI exposes them; e2e drives the app as a user would. */
const PRESET_IDS = ['sloop', 'brig', 'frigate-28', 'frigate-38', 'third-rate-74']

/**
 * Phase 1 demo script: one broadside profile per preset, plus an orbit view of
 * the frigate. These are for looking at, per CLAUDE.md rule 2.
 */
test.describe('hull gallery', () => {
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
})
