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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { UserChartsFilters } from '@/features/dashboard/types'

import { UsersFilter } from '../users-filter-dialog'

const initialFilters: UserChartsFilters = {
  timeGranularity: 'hour',
  range: {
    start: new Date('2025-01-01T00:00:00'),
    end: new Date('2025-01-02T00:00:00'),
  },
  topUserLimit: 10,
}

describe('UsersFilter', () => {
  test('applies the picked quick range and keeps the other user filters', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(
      <UsersFilter
        filters={initialFilters}
        onFiltersChange={onFiltersChange}
        onReset={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: '7 Days' }))
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }))

    expect(onFiltersChange).toHaveBeenCalledTimes(1)
    const next = onFiltersChange.mock.calls[0][0] as UserChartsFilters
    expect(next.timeGranularity).toBe('hour')
    expect(next.topUserLimit).toBe(10)
    const spanDays =
      (next.range.end.getTime() - next.range.start.getTime()) / 86_400_000
    expect(spanDays).toBeCloseTo(7, 5)
  })

  test('keeps the applied range when the dialog is reopened', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(
      <UsersFilter
        filters={initialFilters}
        onFiltersChange={onFiltersChange}
        onReset={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Apply Filters' }))

    const next = onFiltersChange.mock.calls[0][0] as UserChartsFilters
    expect(next.range.start).toEqual(initialFilters.range.start)
    expect(next.range.end).toEqual(initialFilters.range.end)
  })

  test('blocks applying a range longer than the statistics limit', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    render(
      <UsersFilter
        filters={{
          ...initialFilters,
          range: {
            start: new Date('2025-01-01T00:00:00'),
            end: new Date('2025-02-15T00:00:00'),
          },
        }}
        onFiltersChange={onFiltersChange}
        onReset={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Filter' }))

    expect(
      screen.getByText(/Date range cannot exceed .* days/)
    ).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: 'Apply Filters' })
    expect(apply).toBeDisabled()
    expect(onFiltersChange).not.toHaveBeenCalled()
  })

  test('delegates resetting to the dashboard defaults', async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    render(
      <UsersFilter
        filters={initialFilters}
        onFiltersChange={vi.fn()}
        onReset={onReset}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
