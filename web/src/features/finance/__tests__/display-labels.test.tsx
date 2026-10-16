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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
  Link: (props: { children: ReactNode; 'aria-current'?: 'page' }) => (
    <a href='#' aria-current={props['aria-current']}>
      {props.children}
    </a>
  ),
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
        'Redemption Ledger': '兑换码台账',
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
    getFinanceRedemptions.mockResolvedValue({ items: [], total: 0 })
    getFinanceRebates.mockResolvedValue({ items: [], total: 0 })
    getFinancialOperations.mockResolvedValue({ items: [], total: 0 })
    searchUsers.mockResolvedValue({
      success: true,
      data: { items: [], total: 0 },
    })
  })

  test.each([
    ['topups', '充值订单'],
    ['redemptions', '兑换码台账'],
    ['rebates', '返佣账本'],
    ['operations', '财务操作'],
  ])(
    'shows a standalone %s page without sibling ledger tabs',
    (section, title) => {
      renderPage(section)

      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
      for (const name of ['充值订单', '兑换码台账', '返佣账本', '财务操作']) {
        expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
      }
    }
  )

  test('shows translated filter labels for the default values', async () => {
    renderPage()

    await waitFor(() => expect(getFinanceTopups).toHaveBeenCalled())

    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes[0]).toHaveTextContent('全部状态')
    expect(comboboxes[1]).toHaveTextContent('全部支付平台')
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(document.body).not.toHaveTextContent(/^all$/im)
    expect(
      screen.getByRole('columnheader', { name: 'Order number' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Amount' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Status' })
    ).toBeInTheDocument()
  })

  test('opens offline refund registration separately from consumption refunds', async () => {
    renderPage('cash-refunds')

    expect(
      screen.getByRole('heading', { name: 'Offline refund registration' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Consumption refunds/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Offline refund registration/ })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.queryByRole('button', { name: 'Apply penalty' })
    ).not.toBeInTheDocument()
    await waitFor(() => expect(getFinanceTopups).toHaveBeenCalled())
  })

  test('offline registration still switches between top-up and redemption sources', async () => {
    const user = userEvent.setup()
    renderPage('cash-refunds')

    expect(screen.getByRole('button', { name: '充值订单' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await user.click(screen.getByRole('button', { name: '兑换码台账' }))

    expect(screen.getByRole('button', { name: '兑换码台账' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: '充值订单' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await waitFor(() => expect(getFinanceRedemptions).toHaveBeenCalled())
  })

  test('offline registration shows source eligibility as a visible disabled action', async () => {
    getFinanceTopups.mockResolvedValue({
      items: [
        {
          id: 1,
          trade_no: 'captured-order',
          status: 'success',
          source: 'topup',
          credited_quota: 1000,
          user_quota: 2000,
          money: 50,
        },
        {
          id: 2,
          trade_no: 'already-refunded',
          status: 'refunded',
          source: 'topup',
          credited_quota: 1000,
          money: 50,
        },
        {
          id: 3,
          trade_no: 'subscription-order',
          status: 'success',
          source: 'subscription',
          credited_quota: 1000,
          money: 50,
        },
      ],
      total: 3,
    })
    renderPage('cash-refunds')
    await screen.findByText('captured-order')
    expect(
      within(screen.getByRole('row', { name: /captured-order/ })).getByRole(
        'button',
        { name: 'Register refund' }
      )
    ).toBeEnabled()
    expect(
      within(screen.getByRole('row', { name: /already-refunded/ })).getByRole(
        'button',
        { name: 'Register refund' }
      )
    ).toBeDisabled()
    expect(
      within(screen.getByRole('row', { name: /subscription-order/ })).getByRole(
        'button',
        { name: 'Register refund' }
      )
    ).toBeDisabled()
  })

  test('offline registration selects a user from remote search and loads that user orders', async () => {
    searchUsers.mockResolvedValue({
      success: true,
      data: { items: [{ id: 7, username: 'alice', display_name: 'Alice' }] },
    })
    const user = userEvent.setup()
    renderPage('cash-refunds')
    const input = screen.getByRole('combobox', { name: 'User' })
    await user.click(input)
    await user.type(input, 'ali')
    await user.click(
      await screen.findByRole('option', { name: 'Alice (@alice) · #7' })
    )
    await waitFor(() =>
      expect(getFinanceTopups).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: 7 })
      )
    )
  })

  test('offline filters open in a dialog on mobile without crowding the order list', async () => {
    const originalMatchMedia = Object.getOwnPropertyDescriptor(
      window,
      'matchMedia'
    )
    if (!originalMatchMedia) {
      throw new Error('matchMedia fixture is unavailable')
    }
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('max-width: 640px'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })
    try {
      const user = userEvent.setup()
      renderPage('cash-refunds')
      expect(
        screen.queryByRole('textbox', { name: 'Order number' })
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Filters' }))
      const dialog = screen.getByRole('dialog')
      expect(
        within(dialog).getByRole('textbox', { name: 'Order number' })
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('combobox', { name: 'User' })
      ).toBeInTheDocument()
      await user.click(
        within(dialog).getByRole('button', { name: 'Apply filters' })
      )
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
    } finally {
      Object.defineProperty(window, 'matchMedia', originalMatchMedia)
    }
  })

  test('renders the mobile list layout on narrow viewports', async () => {
    getFinanceTopups.mockResolvedValue({
      items: [
        {
          id: 8,
          user_id: 12,
          amount: 1000000,
          money: 10,
          trade_no: 'trade-8',
          payment_method: 'epay',
          create_time: 1700000000,
          status: 'success',
          source: 'topup',
          credited_quota: 1000000,
          user_quota: 2000000,
        },
      ],
      total: 1,
    })
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('max-width: 640px'),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    })

    try {
      renderPage()

      await screen.findByText('trade-8')
      expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
      expect(
        screen.getByText('Success', {
          selector: '[data-slot=status-badge] span',
        })
      ).toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      })
    }
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
          credited_quota: 1000000,
          user_quota: 2000000,
        },
      ],
      total: 1,
    })
    refundFinanceTopup.mockResolvedValue({ success: true })
    const user = userEvent.setup()

    renderPage()

    await screen.findByText('trade-7')
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Refund top-up' })
    )

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
        expect.stringMatching(/^manual-/),
        false
      )
    )
  })
})
