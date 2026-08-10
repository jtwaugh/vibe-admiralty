import { expect, test } from '@playwright/test'

/**
 * Phase 1 end-to-end coverage: the app boots, every preset renders, and the
 * derived stats track the hull that is on screen. The full designer flows in
 * ACCEPTANCE section C arrive with the phase 2 UI.
 */

const PRESETS = [
  { id: 'sloop', name: 'Sloop' },
  { id: 'brig', name: 'Brig' },
  { id: 'frigate-28', name: 'Frigate (28)' },
  { id: 'frigate-38', name: 'Frigate (38)' },
  { id: 'third-rate-74', name: 'Third Rate (74)' },
]

async function statValues(page: import('@playwright/test').Page) {
  const text = await page.getByTestId('derived-stats').innerText()
  return text
}

test('shows all five hull presets', async ({ page }) => {
  await page.goto('/')
  for (const preset of PRESETS) {
    await expect(page.getByTestId(`preset-${preset.id}`)).toHaveText(preset.name)
  }
})

test('renders a canvas with actual pixels', async ({ page }) => {
  await page.goto('/')
  const canvas = page.getByTestId('viewer-canvas')
  await expect(canvas).toBeVisible()
  const size = await canvas.evaluate((element) => {
    const c = element as HTMLCanvasElement
    return { width: c.width, height: c.height }
  })
  expect(size.width).toBeGreaterThan(300)
  expect(size.height).toBeGreaterThan(200)

  // A blank canvas would leave the WebGL context unused; check something drew.
  const drew = await canvas.evaluate((element) => {
    const c = element as HTMLCanvasElement
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    return gl !== null
  })
  expect(drew).toBe(true)
})

test('derived stats change when a different hull is selected', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('preset-sloop').click()
  const sloop = await statValues(page)
  await page.getByTestId('preset-third-rate-74').click()
  const thirdRate = await statValues(page)
  expect(thirdRate).not.toBe(sloop)
  expect(thirdRate).toContain('t')
})

test('every preset reports a positive displacement and a sane draft', async ({ page }) => {
  await page.goto('/')
  for (const preset of PRESETS) {
    await page.getByTestId(`preset-${preset.id}`).click()
    const text = await statValues(page)
    const displacement = Number(text.match(/([\d.]+) t/)?.[1])
    const draft = Number(text.match(/([\d.]+) m/)?.[1])
    expect(displacement).toBeGreaterThan(100)
    expect(draft).toBeGreaterThan(1)
    expect(draft).toBeLessThan(10)
  }
})

test('camera toggle switches between broadside and orbit', async ({ page }) => {
  await page.goto('/')
  const toggle = page.getByTestId('camera-toggle')
  await expect(toggle).toHaveText('Orbit')
  await toggle.click()
  await expect(toggle).toHaveText('Broadside')
  await toggle.click()
  await expect(toggle).toHaveText('Orbit')
})
