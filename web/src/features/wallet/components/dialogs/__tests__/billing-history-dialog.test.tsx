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
import { render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { BillingHistoryDialog } from '../billing-history-dialog'

const useBillingHistory = vi.hoisted(() => vi.fn())

vi.mock('../../../hooks/use-billing-history', () => ({ useBillingHistory }))

describe('BillingHistoryDialog', () => {
  test('shows paid and bonus quota for redeemed codes', async () => {
    useBillingHistory.mockReturnValue({
      records: [
        {
          id: 1,
          record_type: 'redemption',
          user_id: 1,
          amount: 0,
          money: 0,
          trade_no: '',
          payment_method: '',
          create_time: 1,
          status: 'used',
          redemption_id: 1,
          redemption_name: '测试买五送一',
          redemption_key: 'test-redemption-key',
          redemption_type: 'paid',
          redemption_quota: 3000000,
          redemption_paid_quota: 2500000,
          redemption_bonus_quota: 500000,
          redeemed_time: 1,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
      keyword: '',
      loading: false,
      handlePageChange: vi.fn(),
      handlePageSizeChange: vi.fn(),
      handleSearch: vi.fn(),
    })

    render(
      <I18nextProvider i18n={i18next}>
        <BillingHistoryDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('测试买五送一')).toBeInTheDocument()
    })
    expect(screen.getByText('Paid quota')).toBeInTheDocument()
    expect(screen.getByText('Bonus quota')).toBeInTheDocument()
    expect(screen.getByText('🥚 5')).toBeInTheDocument()
    expect(screen.getByText('🥚 1')).toBeInTheDocument()
  })

  test('renders pending and failed top-up states honestly', async () => {
    useBillingHistory.mockReturnValue({
      records: [
        {
          id: 1,
          record_type: 'topup',
          user_id: 1,
          amount: 10,
          money: 10,
          trade_no: 'pending-order',
          payment_method: 'stripe',
          create_time: 1,
          status: 'pending',
        },
        {
          id: 2,
          record_type: 'topup',
          user_id: 1,
          amount: 10,
          money: 10,
          trade_no: 'failed-order',
          payment_method: 'stripe',
          create_time: 2,
          status: 'failed',
        },
        {
          id: 3,
          record_type: 'topup',
          user_id: 1,
          amount: 10,
          money: 10,
          trade_no: 'refunded-order',
          payment_method: 'stripe',
          create_time: 3,
          status: 'refunded',
        },
      ],
      total: 3,
      page: 1,
      pageSize: 10,
      keyword: '',
      loading: false,
      handlePageChange: vi.fn(),
      handlePageSizeChange: vi.fn(),
      handleSearch: vi.fn(),
    })

    render(
      <I18nextProvider i18n={i18next}>
        <BillingHistoryDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    )

    expect(await screen.findByText('pending-order')).toBeVisible()
    expect(screen.getByText('Pending')).toBeVisible()
    expect(screen.getByText('Failed')).toBeVisible()
    expect(screen.getByText('Refunded')).toBeVisible()
  })
})
