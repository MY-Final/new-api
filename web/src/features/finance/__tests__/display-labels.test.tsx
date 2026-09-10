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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { Finance } from '../index'

const getFinanceTopups = vi.hoisted(() => vi.fn())
const getFinanceRedemptions = vi.hoisted(() => vi.fn())
const getFinanceRebates = vi.hoisted(() => vi.fn())
const getFinancialOperations = vi.hoisted(() => vi.fn())
const completeFinanceTopup = vi.hoisted(() => vi.fn())
const refundFinanceTopup = vi.hoisted(() => vi.fn())
const refundFinanceRedemption = vi.hoisted(() => vi.fn())
const reverseFinanceRebate = vi.hoisted(() => vi.fn())
const applyFinancePenalty = vi.hoisted(() => vi.fn())
const reverseFinancePenalty = vi.hoisted(() => vi.fn())
const searchUsers = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href='#'>{children}</a>,
}))

vi.mock('../api', () => ({
  applyFinancePenalty,
  completeFinanceTopup,
  getFinanceRebates,
  getFinanceRedemptions,
  getFinanceTopups,
  getFinancialOperations,
  refundFinanceRedemption,
  refundFinanceTopup,
  reverseFinancePenalty,
  reverseFinanceRebate,
}))

vi.mock('@/features/users/api', async (importOriginal) => ({
  ...(await importOriginal()),
  searchUsers,
}))

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: {
    zh: {
      translation: {
        'All providers': '全部支付平台',
        'All statuses': '全部状态',
        'Custom penalty': '自定义罚款',
        'Custom penalties do not require a request ID.':
          '自定义罚款无需填写请求 ID。',
        'Date Range': '时间范围',
        Finance: '财务',
        'Financial Operations': '财务操作',
        'Loading...': '加载中...',
        'No financial records found': '暂无财务记录',
        'No users found': '未找到用户',
        'Rebate Ledger': '返佣账本',
        'Request-based penalty': '按请求罚款',
        'Search by username, name, or ID': '按用户名、名称或 ID 搜索',
        'Target user': '目标用户',
        'Top-up Orders': '充值订单',
        'User ID': '用户 ID',
        'Current balance': '当前余额',
      },
    },
  },
})

function renderPage(section = 'topups') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <Finance section={section} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe('finance display labels', () => {
  beforeEach(() => {
    for (const mock of [
      getFinanceTopups,
      getFinanceRedemptions,
      getFinanceRebates,
      getFinancialOperations,
      completeFinanceTopup,
      refundFinanceTopup,
      refundFinanceRedemption,
      reverseFinanceRebate,
      applyFinancePenalty,
      reverseFinancePenalty,
      searchUsers,
    ]) {
      mock.mockReset()
    }
    getFinanceTopups.mockResolvedValue({ items: [], total: 0 })
    searchUsers.mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    })
  })

  test('shows translated tabs and filter labels for the default values', async () => {
    renderPage()

    await waitFor(() => expect(getFinanceTopups).toHaveBeenCalled())

    expect(screen.getByRole('link', { name: '充值订单' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返佣账本' })).toBeInTheDocument()
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes[0]).toHaveTextContent('全部状态')
    expect(comboboxes[1]).toHaveTextContent('全部支付平台')
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(document.body).not.toHaveTextContent(/^all$/im)
  })

  test('opens the refund dialog and submits after confirmation', async () => {
    getFinanceTopups.mockResolvedValue({
      items: [
        {
          id: 7,
          user_id: 12,
          amount: 1000000,
          money: 10,
          trade_no: 'trade-7',
          payment_method: 'epay',
          create_time: 1700000000,
          status: 'success',
          source: 'topup',
        },
      ],
      total: 1,
    })
    refundFinanceTopup.mockResolvedValue({ success: true })
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('trade-7')
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))

    expect(
      await screen.findByRole('heading', { name: 'Refund top-up' })
    ).toBeInTheDocument()
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    expect(continueButton).toBeDisabled()

    await user.type(
      screen.getByRole('textbox', { name: 'Reason' }),
      'Customer request'
    )
    await user.click(screen.getByRole('checkbox'))
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)

    expect(refundFinanceTopup).not.toHaveBeenCalled()
    expect(
      screen.getByText('This action cannot be undone.')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(refundFinanceTopup).toHaveBeenCalledWith(
        'trade-7',
        'Customer request'
      )
    )
  })

  test('selects a penalty target by searching users instead of entering an ID', async () => {
    getFinancialOperations.mockResolvedValue({ items: [], total: 0 })
    searchUsers.mockResolvedValue({
      success: true,
      data: {
        items: [
          {
            id: 23,
            username: 'alice',
            display_name: 'Alice',
            quota: 1000,
          },
        ],
        total: 1,
      },
    })
    const user = userEvent.setup()

    renderPage('operations')

    await waitFor(() => expect(getFinancialOperations).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Apply penalty' }))

    const userPicker = await screen.findByRole('combobox', {
      name: '目标用户',
    })
    await user.type(userPicker, 'alice')
    await user.click(await screen.findByRole('option', { name: /alice/ }))

    expect(screen.getByText(/用户 ID: 23/)).toBeInTheDocument()
    expect(screen.getByText(/当前余额/)).toBeInTheDocument()

    applyFinancePenalty.mockResolvedValue({ success: true })
    await user.click(screen.getByRole('button', { name: '自定义罚款' }))
    await user.type(screen.getByRole('spinbutton'), '3')
    await user.type(
      screen.getByRole('textbox', { name: 'Reason' }),
      'Account abuse'
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(applyFinancePenalty).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(applyFinancePenalty).toHaveBeenCalledWith(
        23,
        1_500_000,
        'Account abuse',
        expect.stringMatching(/^manual-/)
      )
    )
  })
})
