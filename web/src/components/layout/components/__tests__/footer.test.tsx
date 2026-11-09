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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Footer } from '../footer'

vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({
    footerHtml: '',
  }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({
    status: undefined,
  }),
}))

const contactSettings = vi.hoisted(() => ({
  current: {
    title: 'Contact Us',
    description: '',
    qqGroupNumber: '',
    qqGroupURL: '',
    qrcodeSrc: '',
    configured: false,
  },
}))

vi.mock('@/features/contact/use-contact-settings', () => ({
  useContactSettings: () => contactSettings.current,
}))

afterEach(() => {
  cleanup()
  contactSettings.current = {
    title: 'Contact Us',
    description: '',
    qqGroupNumber: '',
    qqGroupURL: '',
    qrcodeSrc: '',
    configured: false,
  }
})

async function renderFooter() {
  const root = createRootRoute({
    component: () => <Footer />,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()

  render(<RouterProvider router={router} />)
}

describe('Footer', () => {
  it('uses the KunRouter brand and copyright while keeping New API as the source', async () => {
    await renderFooter()

    expect(screen.getByRole('link', { name: /KunRouter/ })).toBeVisible()
    expect(screen.getByRole('contentinfo').textContent).toContain(
      `© ${new Date().getFullYear()} KunRouter.`
    )

    const newApiLinks = screen.getAllByRole('link', { name: 'New API' })
    expect(newApiLinks).toHaveLength(1)
    expect(newApiLinks[0]).toHaveAttribute(
      'href',
      'https://github.com/QuantumNous/new-api'
    )
    expect(
      screen.queryByText(new RegExp(`©.*New API`, 'i'))
    ).not.toBeInTheDocument()
  })

  it('links the main footer navigation to the existing app routes', async () => {
    await renderFooter()

    expect(screen.getByRole('link', { name: 'API Keys' })).toHaveAttribute(
      'href',
      '/keys'
    )
    expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute(
      'href',
      '/pricing'
    )
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute(
      'href',
      '/about'
    )
  })

  it('exposes a contact entry even when no contact details are configured', async () => {
    await renderFooter()

    expect(screen.getByRole('link', { name: 'Contact Us' })).toHaveAttribute(
      'href',
      '/contact'
    )
  })

  it('shows the configured QQ group contact details', async () => {
    contactSettings.current = {
      ...contactSettings.current,
      qqGroupNumber: '123456789',
      qqGroupURL: 'https://example.com/qq',
      configured: true,
    }

    await renderFooter()

    expect(screen.getByText('123456789')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Join QQ Group' })).toHaveAttribute(
      'href',
      'https://example.com/qq'
    )
  })
})
