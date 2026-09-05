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
    expect(document.body).not.toHaveTextContent(/^all$/im)
  })
})
