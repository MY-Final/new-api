/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { DataTableServerPagination } from '../pagination'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Total:': 'Total:',
        'Rows per page': 'Rows per page',
        'Go to first page': 'Go to first page',
        'Go to previous page': 'Go to previous page',
        'Go to next page': 'Go to next page',
        'Go to last page': 'Go to last page',
        'Go to page {{page}}': 'Go to page {{page}}',
      },
    },
  },
})

describe('DataTableServerPagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('shows total, page numbers, and disabled states for the current page', () => {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()

    render(
      <I18nextProvider i18n={i18n}>
        <DataTableServerPagination
          page={2}
          pageSize={20}
          total={95}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('95')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Go to page 2' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('button', { name: 'Go to first page' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Go to last page' })
    ).toBeEnabled()
  })

  test('notifies page and page-size changes through the shared controls', async () => {
    const onPageChange = vi.fn()
    const onPageSizeChange = vi.fn()
    const user = userEvent.setup()

    render(
      <I18nextProvider i18n={i18n}>
        <DataTableServerPagination
          page={1}
          pageSize={20}
          total={95}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </I18nextProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(onPageChange).toHaveBeenCalledWith(2)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: '50' }))
    expect(onPageSizeChange).toHaveBeenCalledWith(50)
  })
})
