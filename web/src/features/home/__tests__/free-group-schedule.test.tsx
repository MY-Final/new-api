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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import dayjs from '@/lib/dayjs'

import { FreeGroupScheduleDialog } from '../components/free-group-schedule'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows today, tomorrow, and the selected day from the public calendar', async () => {
  const today = dayjs()
  const tomorrow = today.add(1, 'day')
  const target = today.startOf('month').add(14, 'day')
  const days = Array.from({ length: today.daysInMonth() }, (_, index) =>
    today.startOf('month').add(index, 'day')
  ).map((date) => ({
    date: date.format('YYYY-MM-DD'),
    group:
      date.format('YYYY-MM-DD') === target.format('YYYY-MM-DD')
        ? 'override-eggs'
        : 'default-eggs',
    source:
      date.format('YYYY-MM-DD') === target.format('YYYY-MM-DD')
        ? 'date'
        : 'default',
    enabled: true,
    daily_limit: 10,
    user_limit: 2,
  }))
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        today: today.format('YYYY-MM-DD'),
        tomorrow: tomorrow.format('YYYY-MM-DD'),
        enabled: true,
        default_group: 'default-eggs',
        today_group: 'today-eggs',
        tomorrow_group: 'tomorrow-eggs',
        days,
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <FreeGroupScheduleDialog />
    </QueryClientProvider>
  )
  const user = userEvent.setup()

  await user.click(screen.getByRole('button', { name: 'View schedule' }))
  const dialog = await screen.findByRole('dialog')
  const todayGroup = await within(dialog).findByRole('group', { name: 'Today' })
  expect(within(todayGroup).getByText('today-eggs')).toBeVisible()
  expect(
    within(within(dialog).getByRole('group', { name: 'Tomorrow' })).getByText(
      'tomorrow-eggs'
    )
  ).toBeVisible()
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/free_group/schedule', {
      params: {
        from: today.startOf('month').format('YYYY-MM-DD'),
        to: today.endOf('month').format('YYYY-MM-DD'),
      },
    })
  )

  await user.click(
    within(dialog).getByRole('button', {
      name: new RegExp(target.format('dddd, MMMM D')),
    })
  )
  expect(within(dialog).getByText('override-eggs')).toBeVisible()
  expect(within(dialog).getByText('Date override')).toBeVisible()
})
