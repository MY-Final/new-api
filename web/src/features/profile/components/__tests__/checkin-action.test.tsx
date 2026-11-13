import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'
import {
  ThemeCustomizationProvider,
  useThemeCustomization,
} from '@/context/theme-customization-provider'
import { THEME_STORAGE_KEYS } from '@/lib/theme-storage'

import { CheckinAction } from '../checkin-action'

const animate = vi.fn()
const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
)

function ThemeControls() {
  const { setPreset } = useThemeCustomization()
  return (
    <>
      <Button onClick={() => setPreset('basketball')}>Basketball preset</Button>
      <Button onClick={() => setPreset('default')}>Suspenders preset</Button>
    </>
  )
}

function renderAction(props?: Partial<ComponentProps<typeof CheckinAction>>) {
  const onCheckin = vi.fn()
  render(
    <ThemeCustomizationProvider>
      <ThemeControls />
      <CheckinAction loading={false} onCheckin={onCheckin} {...props} />
    </ThemeCustomizationProvider>
  )
  return onCheckin
}

beforeEach(() => {
  localStorage.clear()
  animate.mockReset()
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: animate,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  if (originalAnimate) {
    Object.defineProperty(Element.prototype, 'animate', originalAnimate)
  } else {
    Reflect.deleteProperty(Element.prototype, 'animate')
  }
  for (const name of document.body.getAttributeNames()) {
    if (name.startsWith('data-theme-')) document.body.removeAttribute(name)
  }
})

it('changes the check-in action with the preset without reloading', async () => {
  renderAction()
  expect(
    screen.getByRole('button', { name: 'Shoulder bump to check in' })
  ).toBeEnabled()

  await userEvent.click(
    screen.getByRole('button', { name: 'Basketball preset' })
  )
  expect(
    screen.getByRole('button', { name: 'Dribble to check in' })
  ).toBeEnabled()
  expect(
    screen.getByText("Tap the basketball for today's reward.")
  ).toBeVisible()

  await userEvent.click(
    screen.getByRole('button', { name: 'Suspenders preset' })
  )
  expect(
    screen.getByRole('button', { name: 'Shoulder bump to check in' })
  ).toBeEnabled()
})

it.each([
  ['default', 'Shoulder bump to check in', 'translateX(14px) rotate(16deg)'],
  ['basketball', 'Dribble to check in', 'translateY(18px) scale(1.12, 0.88)'],
])(
  'plays the %s action and submits on one click',
  async (preset, label, move) => {
    localStorage.setItem(THEME_STORAGE_KEYS.preset, preset)
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    vi.spyOn(window, 'matchMedia').mockReturnValue({ ...media, matches: false })
    const onCheckin = renderAction()

    await userEvent.click(screen.getByRole('button', { name: label }))

    expect(onCheckin).toHaveBeenCalledTimes(1)
    expect(animate).toHaveBeenCalledWith(
      expect.arrayContaining([{ transform: move }]),
      expect.objectContaining({ duration: 650 })
    )
  }
)

it.each(['{Enter}', ' '])(
  'supports keyboard check-in with %s while reduced motion is enabled',
  async (key) => {
    const onCheckin = renderAction()
    screen.getByRole('button', { name: 'Shoulder bump to check in' }).focus()

    await userEvent.keyboard(key)

    expect(onCheckin).toHaveBeenCalledTimes(1)
    expect(animate).not.toHaveBeenCalled()
  }
)

it.each([
  [{ loading: true }, 'Loading...', 'true'],
  [{ checkedToday: true }, 'Checked in', 'false'],
])('prevents check-in when %j', async (props, label, busy) => {
  const onCheckin = renderAction(props)
  const button = screen.getByRole('button', { name: label })

  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-busy', busy)
  await userEvent.click(button)
  expect(onCheckin).not.toHaveBeenCalled()
})
