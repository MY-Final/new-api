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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { formatQuotaWithCurrency } from '@/lib/currency'
import { api } from '@/lib/http-client'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { CheckinCalendarCard } from '../checkin-calendar-card'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

const clients: QueryClient[] = []

function eggCurrency() {
  return {
    ...DEFAULT_CURRENCY_CONFIG,
    quotaDisplayType: 'CUSTOM' as const,
    quotaPerUnit: 500000,
    customCurrencySymbol: '🥚',
    customCurrencyExchangeRate: 1,
  }
}

function currentMonthKey(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7)
}

function previousMonthLabel(): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  )
  return previous.toISOString().slice(0, 7)
}

function mockCheckin(
  records: { checkin_date: string; quota_awarded: number }[]
) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const month = String(url).split('month=')[1]
    const monthRecords = records.filter((record) =>
      record.checkin_date.startsWith(month)
    )
    return {
      data: {
        success: true,
        data: {
          enabled: true,
          stats: {
            checked_in_today: false,
            total_checkins: 2,
            total_quota: 39550,
            current_streak: 3,
            checkin_count: monthRecords.length,
            records: monthRecords,
          },
        },
      },
    } as never
  })
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <CheckinCalendarCard
          checkinEnabled
          turnstileEnabled={false}
          turnstileSiteKey=''
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({ currency: eggCurrency() })
  mockCheckin([
    { checkin_date: `${currentMonthKey()}-05`, quota_awarded: 39550 },
  ])
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  vi.useRealTimers()
  useSystemConfigStore.getState().setConfig({ currency: eggCurrency() })
})

function statValues(): (string | null)[] {
  return [...document.querySelectorAll("[data-slot='checkin-stat-value']")].map(
    (el) => el.textContent
  )
}

function statLabels(): (string | null)[] {
  return [...document.querySelectorAll("[data-slot='checkin-stat-label']")].map(
    (el) => el.textContent
  )
}

it('keeps the reward unit out of the stat values', async () => {
  renderCard()

  // A wide custom symbol inside the value wraps these narrow cells, so the
  // amounts stay symbol-free and the unit sits next to the label instead.
  await waitFor(() => {
    expect(statValues()).toEqual(['1', '3', '0.0791', '0.0791'])
  })
  expect(statLabels()).toEqual([
    "This month's check-ins",
    'Current streak',
    "This month's rewards🥚",
    'Total earned🥚',
  ])
})

it('keeps current-month statistics while browsing earlier records', async () => {
  renderCard()

  await waitFor(() => {
    expect(statLabels()[2]).toBe("This month's rewards🥚")
  })

  await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))

  await waitFor(() => {
    expect(screen.getByText('No records')).toBeInTheDocument()
  })
  expect(screen.getAllByText(previousMonthLabel())).toHaveLength(2)
  expect(statValues()).toEqual(['1', '3', '0.0791', '0.0791'])
})

it('shows this week’s rewards across month boundaries', async () => {
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
  vi.restoreAllMocks()
  mockCheckin([{ checkin_date: '2026-10-31', quota_awarded: 39550 }])
  renderCard()

  expect(
    await screen.findByText(`+${formatQuotaWithCurrency(39550)}`)
  ).toBeInTheDocument()
  expect(screen.getByText('10-26 – 11-01')).toBeInTheDocument()
})

it('shows a selected check-in reward without requiring hover', async () => {
  renderCard()
  const date = `${currentMonthKey()}-05`
  const reward = formatQuotaWithCurrency(39550)
  await userEvent.click(
    await screen.findByRole('button', { name: `${date}: +${reward}` })
  )
  expect(screen.getByText(`${date}: +${reward}`)).toBeInTheDocument()
})
