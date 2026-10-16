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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { CashRefundDialog } from '../components/cash-refund-dialog'
import type { FinanceAction, FinanceTopup } from '../types'

const api = vi.hoisted(() => ({
  refundFinanceTopup: vi.fn(),
  refundFinanceRedemption: vi.fn(),
}))
vi.mock('../api', () => api)
const i18n = createInstance()
await i18n.use(initReactI18next).init({ lng: 'en', resources: { en } })
const topup: FinanceTopup = {
  id: 42,
  user_id: 7,
  username: 'Alice',
  amount: 1,
  credited_quota: 500_000,
  user_quota: 400_000,
  money: 50,
  trade_no: 'order-50',
  payment_method: 'alipay',
  status: 'success',
  source: 'topup',
  create_time: 1_700_000_000,
}
const close = vi.fn()
const success = vi.fn()
function show(
  action: Extract<
    FinanceAction,
    { kind: 'topup-refund' | 'redemption-refund' }
  > = { kind: 'topup-refund', item: topup }
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        <CashRefundDialog action={action} onClose={close} onSuccess={success} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}
const originalConfig = useSystemConfigStore.getState().config
afterEach(() => useSystemConfigStore.setState({ config: originalConfig }))
beforeEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({
      currency: { ...originalConfig.currency, quotaDisplayType: 'USD' },
    })
  vi.clearAllMocks()
  api.refundFinanceTopup.mockResolvedValue({ success: true })
  api.refundFinanceRedemption.mockResolvedValue({ success: true })
})

test('requires explicit acceptance when refunding an order after part of its credit was spent', async () => {
  const user = userEvent.setup()
  show()
  expect(screen.getByText('order-50')).toBeInTheDocument()
  expect(screen.getByText('Alice · #7')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('negative balance')
  expect(screen.getByText('−$1')).toBeInTheDocument()
  const next = screen.getByRole('button', { name: 'Continue' })
  expect(next).toBeDisabled()
  await user.type(
    screen.getByRole('textbox', { name: 'Reason' }),
    'Alipay refund: reference 123'
  )
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I confirm the external refund has been completed',
    })
  )
  expect(next).toBeDisabled()
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I confirm the resulting negative balance',
    })
  )
  await user.click(next)
  expect(api.refundFinanceTopup).not.toHaveBeenCalled()
  expect(
    screen.getByText('I confirm the resulting negative balance')
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveValue(
    'Alipay refund: reference 123'
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() => expect(success).toHaveBeenCalledOnce())
  expect(api.refundFinanceTopup).toHaveBeenCalledExactlyOnceWith(
    'order-50',
    'Alipay refund: reference 123'
  )
  expect(api.refundFinanceRedemption).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})

test('keeps the refund preview and reason available when the server rejects registration', async () => {
  api.refundFinanceTopup.mockRejectedValue(
    new Error('Top-up is not refundable')
  )
  const user = userEvent.setup()
  show({ kind: 'topup-refund', item: { ...topup, user_quota: 800_000 } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await user.type(
    screen.getByRole('textbox', { name: 'Reason' }),
    'WeChat reference 456'
  )
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I confirm the external refund has been completed',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  )
  expect(success).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByText('WeChat reference 456')).toBeInTheDocument()
})

test('blocks registration when the original credited quota or balance snapshot is missing', async () => {
  const user = userEvent.setup()
  show({
    kind: 'topup-refund',
    item: { ...topup, credited_quota: undefined, user_quota: undefined },
  })
  await user.type(
    screen.getByRole('textbox', { name: 'Reason' }),
    'Refunded externally'
  )
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I confirm the external refund has been completed',
    })
  )
  expect(screen.getByRole('alert')).toHaveTextContent('Refresh the order')
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  expect(api.refundFinanceTopup).not.toHaveBeenCalled()
})

test('registers a used paid redemption against its source rather than a request', async () => {
  const user = userEvent.setup()
  show({
    kind: 'redemption-refund',
    item: {
      id: 9,
      user_id: 1,
      key: 'paid-code',
      status: 3,
      name: 'Paid voucher',
      quota: 500_000,
      created_time: 1_700_000_000,
      redeemed_time: 1_700_000_010,
      used_user_id: 7,
      expired_time: 0,
      type: 'paid',
      refunded_at: 0,
      refunded_by: 0,
      used_username: 'Alice',
      used_user_quota: 600_000,
    },
  })
  await user.type(
    screen.getByRole('textbox', { name: 'Reason' }),
    'Bank transfer refunded'
  )
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I confirm the external refund has been completed',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(api.refundFinanceRedemption).toHaveBeenCalledExactlyOnceWith(
      9,
      'Bank transfer refunded'
    )
  )
  expect(api.refundFinanceTopup).not.toHaveBeenCalled()
})
