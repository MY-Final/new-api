/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KunCodeAboutPage } from '../kuncode-about-page'

const originalAnimate = Element.prototype.animate

afterEach(() => {
  if (originalAnimate) {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: originalAnimate,
    })
    return
  }
  Reflect.deleteProperty(Element.prototype, 'animate')
})

async function renderAboutPage() {
  const root = createRootRoute({
    component: () => <KunCodeAboutPage />,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/about'] }),
  })
  await router.load()

  render(<RouterProvider router={router} />)
}

function mockAnimate() {
  const animate = vi.fn(() => ({}) as Animation)
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    writable: true,
    value: animate,
  })
  return animate
}

function setReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList
  )
}

describe('KunCode about page', () => {
  it('keeps the suspenders stage artwork large instead of using the default button icon size', async () => {
    await renderAboutPage()

    const stage = screen.getByRole('button', {
      name: 'Trigger the KunCode shoulder bump animation',
    })
    const artwork = within(stage).getByRole('img', { hidden: true })

    expect(artwork).toHaveClass('size-44')
  })

  it('renders the studio story, practice pillars, and keys call to action', async () => {
    await renderAboutPage()

    expect(
      screen.getByRole('heading', { name: 'A studio of one' })
    ).toBeVisible()
    expect(screen.getByText('Sing · Ultimate response')).toBeVisible()
    expect(screen.getByText('Dance · Flexible architecture')).toBeVisible()
    expect(screen.getByText('Rap · Fast concurrency')).toBeVisible()
    expect(screen.getByText('Basketball · Core relay')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /Start practicing now/ })
    ).toHaveAttribute('href', '/keys')
  })

  it('runs the shoulder bump animation when motion is enabled', async () => {
    const animate = mockAnimate()
    setReducedMotion(false)
    await renderAboutPage()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Trigger the KunCode shoulder bump animation',
      })
    )

    expect(animate).toHaveBeenCalledTimes(1)
  })

  it('skips the shoulder bump animation when reduced motion is requested', async () => {
    const animate = mockAnimate()
    setReducedMotion(true)
    await renderAboutPage()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Trigger the KunCode shoulder bump animation',
      })
    )

    expect(animate).not.toHaveBeenCalled()
  })
})
