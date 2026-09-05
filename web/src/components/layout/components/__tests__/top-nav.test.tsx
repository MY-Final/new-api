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
import { fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { TopNav } from '../top-nav'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    disabled: _disabled,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode
    to: string
    disabled?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Contact Us': 'Contact Us',
        'Join QQ Group': 'Join QQ Group',
        'QQ Group Number': 'QQ Group Number',
        'QQ group QR code': 'QQ group QR code',
        'Questions, announcements and communication are welcome.':
          'Questions, announcements and communication are welcome.',
        'Scan the QR code to join, or use the link below.':
          'Scan the QR code to join, or use the link below.',
      },
    },
  },
})

describe('top navigation contact action', () => {
  test('opens the contact dialog instead of navigating to the contact route', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <TopNav links={[{ title: 'Contact Us', href: '/contact' }]} />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('link', { name: 'Contact Us' }))

    expect(
      screen.getByRole('dialog', { name: 'Contact Us' })
    ).toBeInTheDocument()
  })
})
