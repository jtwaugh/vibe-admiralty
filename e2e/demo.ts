import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Driving the widget the way a person would, for the two demo scripts of
 * ACCEPTANCE D and E. Everything here is a click or a drag on a real control:
 * no demo reaches into the state to make a ship behave.
 */

export async function openPreset(page: Page, presetId: string) {
  await page.goto('/')
  await page.getByTestId(`preset-${presetId}`).click()
  await expect(page.getByTestId('designer')).toBeVisible()
  await page.waitForTimeout(500)
}

/** Panel groups start collapsed; open the one we are about to use. */
export async function openGroup(page: Page, name: string) {
  const group = page.getByTestId(`group-${name}`)
  const open = await group.evaluate((element) => (element as HTMLDetailsElement).open)
  if (!open) await group.locator('summary').click()
}

/** Set a range input and fire the events React listens for. */
export async function setSlider(page: Page, testId: string, value: number) {
  await page.getByTestId(testId).evaluate((element, target) => {
    const input = element as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, String(target))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await page.waitForTimeout(220)
}

/** Arm one mount with a given gun, filled to the maximum on both sides. */
export async function armMount(page: Page, socketId: string, gunId: string) {
  await page.getByTestId(`mount-row-${socketId}`).click()
  await expect(page.getByTestId('mount-modal')).toBeVisible()
  await page.getByTestId(`gun-${gunId}`).click()
  const match = page.getByTestId('mount-match')
  if (!(await match.isChecked())) await match.check()
  const more = page.getByTestId('mount-port-more')
  for (let i = 0; i < 20 && (await more.isEnabled()); i++) await more.click()
  await page.getByTestId('mount-close').click()
  await page.waitForTimeout(150)
}

/** Move every gun on a mount to the port side, leaving starboard bare. */
export async function loadPortOnly(page: Page, socketId: string) {
  await page.getByTestId(`mount-row-${socketId}`).click()
  await expect(page.getByTestId('mount-modal')).toBeVisible()
  const match = page.getByTestId('mount-match')
  if (await match.isChecked()) await match.uncheck()
  const portMore = page.getByTestId('mount-port-more')
  for (let i = 0; i < 20 && (await portMore.isEnabled()); i++) await portMore.click()
  const starboardLess = page.getByTestId('mount-starboard-less')
  for (let i = 0; i < 20 && (await starboardLess.isEnabled()); i++) await starboardLess.click()
  await expect(page.getByTestId('mount-starboard')).toHaveText('0')
  await page.getByTestId('mount-close').click()
  await page.waitForTimeout(150)
}

export async function launch(page: Page) {
  await page.getByTestId('btn-launch').click()
  await expect(page.getByTestId('sea-trial')).toBeVisible()
  // Give the scene a moment to build the ocean and compile its shaders.
  await page.waitForTimeout(900)
}

export async function setWind(page: Page, speedKn: number, fromDegrees?: number) {
  if (fromDegrees !== undefined) await setSlider(page, 'wind-direction', fromDegrees)
  await setSlider(page, 'wind-speed', speedKn)
}

/** Set or furl one of the crew's sail groups, if it is not already there. */
export async function handSails(page: Page, group: string, set: boolean) {
  const row = page.getByTestId(`sail-${group}`)
  const pressed = (await row.getAttribute('aria-pressed')) === 'true'
  if (pressed !== set) await row.click()
}

export async function readHud(page: Page) {
  const text = async (testId: string) =>
    (await page.getByTestId(testId).innerText()).replace(/\s+/g, ' ')
  return {
    speed: Number((await text('hud-speed')).replace(/[^0-9.-]/g, '')),
    heel: Number((await text('hud-heel')).split(' ')[1]?.replace(/[^0-9.-]/g, '') ?? '0'),
    heelText: await text('hud-heel'),
    heading: await text('hud-heading'),
    notice: (await page.getByTestId('trial-notice').count())
      ? await text('trial-notice')
      : '',
  }
}

/**
 * Swing the eye round the ship by dragging the canvas, as a user would. The
 * bearing is fixed to the world, so this is the only way to see her lee side.
 */
export async function orbitCamera(page: Page, pixels: number) {
  const canvas = page.getByTestId('viewer-canvas')
  const box = (await canvas.boundingBox())!
  const y = box.y + box.height * 0.4
  const startX = box.x + box.width * 0.5
  await page.mouse.move(startX, y)
  await page.mouse.down()
  const steps = 24
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (pixels * i) / steps, y)
  }
  await page.mouse.up()
  await page.waitForTimeout(400)
}
