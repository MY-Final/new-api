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
const isAdmin = vi.hoisted(() => vi.fn(() => false))
const refundTopUp = vi.hoisted(() => vi.fn())
const reverseAffiliateRebate = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-admin', () => ({ useIsAdmin: isAdmin }))

vi.mock('../../../api', () => ({
  getAffiliateRebates,
  getAllAffiliateRebates,
  isApiSuccess,
  refundTopUp,
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

  test('lets an admin reverse a top-up rebate through the refund flow', async () => {
    isAdmin.mockReturnValue(true)
    const rebate = {
      id: 7,
      inviter_id: 1,
      invitee_id: 2,
      inviter_username: 'inviter',
      invitee_username: 'invitee',
      source_type: 'topup' as const,
      source_id: 'trade-7',
      source_key: 'topup:trade-7',
      base_quota: 1000,
      rate: 1000,
      rebate_quota: 100,
      reversed_quota: 0,
      transferred_quota: 0,
      status: 'settled' as const,
      created_at: 1,
      settled_at: 1,
      reversed_at: 0,
    }
    getAllAffiliateRebates.mockResolvedValue({
      data: { items: [rebate], total: 1 },
    })
    refundTopUp.mockResolvedValue({ success: true })
    isApiSuccess.mockReturnValue(true)
    const user = userEvent.setup()

    render(
      <I18nextProvider i18n={i18next}>
        <AffiliateRebatesDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(getAllAffiliateRebates).toHaveBeenCalledWith(1, 10, undefined)
    })
    await user.click(screen.getByRole('button', { name: 'Reverse' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(refundTopUp).toHaveBeenCalledWith({
        trade_no: 'trade-7',
        reason: '',
      })
    })
    expect(reverseAffiliateRebate).not.toHaveBeenCalled()
  })
})
