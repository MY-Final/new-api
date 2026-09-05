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
*/
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { AffiliateRebatesDialog } from '../affiliate-rebates-dialog'

const getAffiliateRebates = vi.hoisted(() => vi.fn())
const getAllAffiliateRebates = vi.hoisted(() => vi.fn())
const isApiSuccess = vi.hoisted(() => vi.fn())
const reverseAffiliateRebate = vi.hoisted(() => vi.fn())

vi.mock('../../../api', () => ({
  getAffiliateRebates,
  getAllAffiliateRebates,
  isApiSuccess,
  reverseAffiliateRebate,
}))

describe('AffiliateRebatesDialog', () => {
  test('shows the translated all-sources label instead of the raw filter value', async () => {
    getAffiliateRebates.mockResolvedValue({
      data: { items: [], total: 0 },
    })

    render(
      <I18nextProvider i18n={i18next}>
        <AffiliateRebatesDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(getAffiliateRebates).toHaveBeenCalledWith(1, 10, undefined)
    })

    expect(screen.getByRole('combobox')).toHaveTextContent('All sources')
    expect(screen.getByRole('combobox')).not.toHaveTextContent(/^all$/i)
  })

  test('keeps the selected source visible after changing the filter', async () => {
    getAffiliateRebates.mockResolvedValue({
      data: { items: [], total: 0 },
    })
    const user = userEvent.setup()

    render(
      <I18nextProvider i18n={i18next}>
        <AffiliateRebatesDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    )

    await waitFor(() => expect(getAffiliateRebates).toHaveBeenCalled())
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'Top-up' }))

    expect(screen.getByRole('combobox')).toHaveTextContent('Top-up')
    await waitFor(() => {
      expect(getAffiliateRebates).toHaveBeenLastCalledWith(1, 10, 'topup')
    })
  })
})
