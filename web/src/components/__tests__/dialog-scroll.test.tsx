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
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'

import { Dialog } from '../dialog'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

function renderDialog() {
  render(
    <I18nextProvider i18n={i18n}>
      <Dialog
        open
        onOpenChange={() => undefined}
        title='Usage Details'
      >
        <p>body</p>
      </Dialog>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.modalOpen
})

it('locks the console scroll containers while the dialog is open', () => {
  // The console scrolls inside [data-app-scroll-container], not on <body>, so
  // the page behind a modal would otherwise stay scrollable — and keep showing
  // its own scrollbar next to the dialog's.
  renderDialog()

  expect(document.documentElement.dataset.modalOpen).toBe('true')
})

it('keeps the body scroller out of the popup scroll range', () => {
  // A scroll container's scroll range also spans its descendants' scrollable
  // overflow. The body scrolls inside the popup, so without containment every
  // long dialog gains a second, phantom scrollbar whose extra range only
  // reveals blank space below the content.
  renderDialog()
  const popup = screen.getByRole('dialog', { name: 'Usage Details' })
  const body = popup.querySelector("[data-slot='dialog-body']")

  expect(body).toHaveClass('overflow-y-auto', 'min-h-0')
  expect(body).toHaveClass('contain-layout')
  // The popup still scrolls for what the body cannot absorb, such as a header
  // taller than the viewport.
  expect(popup).toHaveClass('overflow-y-auto')
})
