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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { UsageReportSettings } from '../../types'
import { DailyUsageReportCard } from '../daily-usage-report-card'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: ComponentProps<'a'> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const readySettings: UsageReportSettings = {
  enabled: true,
  account_email: 'owner@example.com',
  account_email_verified: true,
  verified_emails: ['owner@example.com'],
  recipients: ['owner@example.com'],
  notification_email: '',
  notification_email_verified: false,
  delivery_ready: true,
  send_hour: 22,
  timezone: 'Asia/Shanghai',
}

const queryClients: QueryClient[] = []

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  return render(
    <QueryClientProvider client={queryClient}>
      <DailyUsageReportCard />
    </QueryClientProvider>
  )
}

function mockSettings(settings: UsageReportSettings) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: settings },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  for (const queryClient of queryClients) queryClient.clear()
  queryClients.length = 0
})

describe('daily usage summary card', () => {
  it('shows the schedule and the verified recipients when delivery is ready', async () => {
    mockSettings(readySettings)
    renderCard()

    const toggle = await screen.findByRole('switch', {
      name: 'Daily usage summary',
    })
    expect(toggle).toBeChecked()
    expect(
      screen.getByText(
        'Beijing time 22:00 · Today 00:00–22:00 · Grouped by group'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('Recipients: owner@example.com')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Bind email' })).toBeNull()
  })

  it('asks for a verified email when there is no deliverable recipient', async () => {
    mockSettings({
      ...readySettings,
      account_email_verified: false,
      verified_emails: [],
      recipients: [],
      delivery_ready: false,
    })
    renderCard()

    expect(
      await screen.findByText(
        'No verified email address yet. Bind and verify an email to receive the report.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bind email' })).toHaveAttribute(
      'href',
      '/security'
    )
  })

  it('stores the switch on its own endpoint and follows the stored state', async () => {
    mockSettings(readySettings)
    const put = vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: true, data: { ...readySettings, enabled: false } },
    })
    renderCard()

    const toggle = await screen.findByRole('switch', {
      name: 'Daily usage summary',
    })
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/user/usage_report', {
        enabled: false,
      })
    )
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('keeps the previous state and reports the failure when saving fails', async () => {
    mockSettings(readySettings)
    vi.spyOn(api, 'put').mockResolvedValue({
      data: { success: false, message: 'failed' },
    })
    renderCard()

    const toggle = await screen.findByRole('switch', {
      name: 'Daily usage summary',
    })
    fireEvent.click(toggle)

    expect(
      await screen.findByText('Save failed, the previous setting is kept')
    ).toBeInTheDocument()
    await waitFor(() => expect(toggle).toBeChecked())
  })
})
