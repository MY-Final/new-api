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
import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'

import { WalletShopPanel } from '../wallet-shop-panel'

const i18n = createInstance()

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en },
    interpolation: { escapeValue: false },
  })
})

const page = {
  name: 'Shop',
  url: 'https://pay.example.com/shop/demo',
  adminOnly: false,
  highlight: true,
  inWallet: true,
  slug: 'shop',
  href: '/embed/shop',
}

it('embeds the shop in a sandboxed frame and keeps a new-tab escape hatch', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <WalletShopPanel page={page} />
    </I18nextProvider>
  )

  const frame = screen.getByTitle('Shop')
  expect(frame.tagName).toBe('IFRAME')
  expect(frame).toHaveAttribute('src', page.url)
  expect(frame).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'
  )

  const open = screen.getByRole('link', { name: 'Open in new tab' })
  expect(open).toHaveAttribute('href', page.url)
  expect(open).toHaveAttribute('target', '_blank')
  expect(open).toHaveAttribute('rel', 'noopener noreferrer')
})
