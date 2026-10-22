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
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { EmailStatistics } from '../../types'
import { EmailStatisticsSection } from '../email-statistics-section'

const baseStatistics: EmailStatistics = {
  provider: 'resend',
  resend_in_use: true,
  start_date: '2026-10-09',
  end_date: '2026-10-22',
  month: { delivered: 120, failed: 2 },
  today: { delivered: 7, failed: 1 },
  resend_month: { delivered: 120, failed: 2 },
  resend_today: { delivered: 7, failed: 1 },
  purposes: [
    { purpose: 'verify', provider: 'resend', delivered: 80, failed: 1 },
    { purpose: 'notification', provider: 'resend', delivered: 40, failed: 1 },
  ],
  daily: [
    {
      date: '2026-10-22',
      purpose: 'verify',
      provider: 'resend',
      delivered: 5,
      failed: 1,
    },
    {
      date: '2026-10-22',
      purpose: 'notification',
      provider: 'resend',
      delivered: 2,
      failed: 0,
    },
    {
      date: '2026-10-21',
      purpose: 'verify',
      provider: 'resend',
      delivered: 9,
      failed: 0,
    },
  ],
}

function renderSection(
  overrides: Partial<EmailStatistics> = {},
  quotas: { daily?: number; monthly?: number } = {}
) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      message: '',
      data: { ...baseStatistics, ...overrides },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <EmailStatisticsSection
        dailyQuota={quotas.daily ?? 100}
        monthlyQuota={quotas.monthly ?? 3000}
      />
    </QueryClientProvider>
  )
}

afterEach(() => vi.restoreAllMocks())

describe('email delivery statistics', () => {
  it('reports today, the current month and each purpose', async () => {
    renderSection()

    expect(await screen.findByText('Sent today')).toBeVisible()
    expect(screen.getByText('Sent today').parentElement).toHaveTextContent('7')
    expect(screen.getByText('Sent this month').parentElement).toHaveTextContent(
      '120'
    )

    const verifyRow = screen.getByRole('row', { name: /Email verification/ })
    expect(within(verifyRow).getByText('80')).toBeVisible()
    const notificationRow = screen.getByRole('row', { name: /Notification/ })
    expect(within(notificationRow).getByText('40')).toBeVisible()
  })

  it('compares Resend volume against the daily and monthly quotas', async () => {
    renderSection({}, { daily: 100, monthly: 3000 })

    expect(await screen.findByText('Resend daily quota used')).toBeVisible()
    expect(screen.getByText('7 / 100')).toBeVisible()
    expect(screen.getByText('93 remaining')).toBeVisible()
    expect(screen.getByText('Resend monthly quota used')).toBeVisible()
    expect(screen.getByText('120 / 3,000')).toBeVisible()
    expect(screen.getByText('2,880 remaining')).toBeVisible()
  })

  it('hides every quota card while Resend is unused', async () => {
    renderSection({ provider: 'smtp', resend_in_use: false })

    expect(await screen.findByText('Sent today')).toBeVisible()
    expect(
      screen.queryByText('Resend daily quota used')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Resend monthly quota used')
    ).not.toBeInTheDocument()
  })

  it('hides only the quota whose limit is disabled', async () => {
    renderSection({}, { daily: 0, monthly: 3000 })

    expect(await screen.findByText('Resend monthly quota used')).toBeVisible()
    expect(
      screen.queryByText('Resend daily quota used')
    ).not.toBeInTheDocument()
  })

  it('adds the daily rows of one date together', async () => {
    renderSection()

    expect(await screen.findByText('2026-10-22')).toBeVisible()
    const dailyRow = screen.getByRole('row', { name: /2026-10-22/ })
    expect(within(dailyRow).getByText('7')).toBeVisible()
    expect(within(dailyRow).getByText('1')).toBeVisible()
  })

  it('shows an empty state before the first email is sent', async () => {
    renderSection({ purposes: [], daily: [] })

    expect(await screen.findAllByText('No data')).toHaveLength(2)
  })

  it('offers a retry when the statistics cannot be loaded', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <EmailStatisticsSection dailyQuota={100} monthlyQuota={3000} />
      </QueryClientProvider>
    )

    expect(
      await screen.findByText('Failed to load email statistics')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
})
