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
import { fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { PaymentRecoveryNotice } from '../payment-recovery-notice'

const useBillingHistory = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/use-billing-history', () => ({ useBillingHistory }))

function mockRecords(records: unknown[]) {
  useBillingHistory.mockReturnValue({
    records,
    total: records.length,
    page: 1,
    pageSize: 10,
    keyword: '',
    loading: false,
    handlePageChange: vi.fn(),
    handlePageSizeChange: vi.fn(),
    handleSearch: vi.fn(),
  })
}

describe('PaymentRecoveryNotice', () => {
  test('shows pending top-ups as unconfirmed with order history recovery', () => {
    const onViewHistory = vi.fn()
    const onStartTopup = vi.fn()
    mockRecords([
      {
        id: 1,
        record_type: 'topup',
        status: 'pending',
        trade_no: 'pending-order',
      },
    ])

    render(
      <I18nextProvider i18n={i18next}>
        <PaymentRecoveryNotice
          onViewHistory={onViewHistory}
          onStartTopup={onStartTopup}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('Payment pending')).toBeVisible()
    expect(
      screen.getByText('Check order history before trying again.')
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Order History' }))
    expect(onViewHistory).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Add Funds' })).toBeNull()
    expect(onStartTopup).not.toHaveBeenCalled()
  })

  test('offers retry and history actions for failed and expired top-ups', () => {
    const onViewHistory = vi.fn()
    const onStartTopup = vi.fn()
    mockRecords([
      {
        id: 1,
        record_type: 'topup',
        status: 'failed',
        trade_no: 'failed-order',
      },
      {
        id: 2,
        record_type: 'topup',
        status: 'expired',
        trade_no: 'expired-order',
      },
    ])

    render(
      <I18nextProvider i18n={i18next}>
        <PaymentRecoveryNotice
          onViewHistory={onViewHistory}
          onStartTopup={onStartTopup}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('Payment needs attention')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Order History' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Funds' }))
    expect(onViewHistory).toHaveBeenCalledTimes(1)
    expect(onStartTopup).toHaveBeenCalledTimes(1)
  })

  test('offers history and retry actions when pending and failed orders are both present', () => {
    const onViewHistory = vi.fn()
    const onStartTopup = vi.fn()
    mockRecords([
      {
        id: 1,
        record_type: 'topup',
        status: 'pending',
        trade_no: 'pending-order',
      },
      {
        id: 2,
        record_type: 'topup',
        status: 'expired',
        trade_no: 'expired-order',
      },
    ])

    render(
      <I18nextProvider i18n={i18next}>
        <PaymentRecoveryNotice
          onViewHistory={onViewHistory}
          onStartTopup={onStartTopup}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('Payment needs attention')).toBeVisible()
    expect(
      screen.getByText('Check order history or try again from Add Funds.')
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Order History' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Funds' }))
    expect(onViewHistory).toHaveBeenCalledTimes(1)
    expect(onStartTopup).toHaveBeenCalledTimes(1)
  })

  test('does not treat refunded top-ups as failed payments', () => {
    mockRecords([
      {
        id: 1,
        record_type: 'topup',
        status: 'refunded',
        trade_no: 'refunded-order',
      },
    ])

    render(
      <I18nextProvider i18n={i18next}>
        <PaymentRecoveryNotice onViewHistory={vi.fn()} onStartTopup={vi.fn()} />
      </I18nextProvider>
    )

    expect(screen.queryByText('Payment needs attention')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add Funds' })).toBeNull()
  })
})
