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
import { render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { AffiliateRebates } from '../index'

const getAffiliateRebates = vi.hoisted(() => vi.fn())

vi.mock('@/features/wallet/api', () => ({ getAffiliateRebates }))

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: {
    zh: {
      translation: {
        'Affiliate Rebates': '返佣明细',
        'All sources': '所有来源',
        'All statuses': '全部状态',
        'Date Range': '时间范围',
        'No referral rebates found': '暂无邀请返佣记录',
      },
    },
  },
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AffiliateRebates />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe('affiliate rebate filters', () => {
  beforeEach(() => {
    getAffiliateRebates.mockReset()
    getAffiliateRebates.mockResolvedValue({ data: { items: [], total: 0 } })
  })

  test('shows translated labels for the default filter values', async () => {
    renderPage()

    await waitFor(() => expect(getAffiliateRebates).toHaveBeenCalled())

    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes[0]).toHaveTextContent('所有来源')
    expect(comboboxes[1]).toHaveTextContent('全部状态')
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3))
    expect(document.body).not.toHaveTextContent(/^all$/im)
    expect(
      screen.getByRole('columnheader', { name: 'Source' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Rebate' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Status' })
    ).toBeInTheDocument()
  })

  test('renders rebate rows with source and status labels in the table', async () => {
    getAffiliateRebates.mockResolvedValue({
      data: {
        items: [
          {
            id: 1,
            inviter_id: 1,
            invitee_id: 2,
            invitee_username: 'alice',
            source_type: 'topup',
            source_id: 'trade-1',
            source_key: '',
            base_quota: 1000000,
            rate: 500,
            rebate_quota: 50000,
            reversed_quota: 0,
            transferred_quota: 50000,
            debt_offset_quota: 0,
            status: 'settled',
            created_at: 1700000000,
            settled_at: 1700000000,
            reversed_at: 0,
          },
        ],
        total: 1,
      },
    })

    renderPage()

    await screen.findByText('alice')
    expect(screen.getByRole('cell', { name: /Top-up/ })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: /Settled/ })).toBeInTheDocument()
  })

  test('renders the mobile list layout on narrow viewports', async () => {
    getAffiliateRebates.mockResolvedValue({
      data: {
        items: [
          {
            id: 2,
            inviter_id: 1,
            invitee_id: 3,
            invitee_username: 'bob',
            source_type: 'signup',
            source_id: 'signup-3',
            source_key: '',
            base_quota: 0,
            rate: 500,
            rebate_quota: 1000,
            reversed_quota: 0,
            transferred_quota: 1000,
            debt_offset_quota: 0,
            status: 'settled',
            created_at: 1700000000,
            settled_at: 1700000000,
            reversed_at: 0,
          },
        ],
        total: 1,
      },
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

      await screen.findByText('bob')
      expect(screen.queryByRole('columnheader')).not.toBeInTheDocument()
      expect(
        screen.getByText('Settled', {
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
})
