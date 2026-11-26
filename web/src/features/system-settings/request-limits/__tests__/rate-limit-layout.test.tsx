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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'

import { RateLimitSection } from '../rate-limit-section'

let client: QueryClient

function renderSection(groupLimits = '{}') {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RateLimitSection
        defaultValues={{
          ModelRequestRateLimitEnabled: false,
          ModelRequestRateLimitDurationMinutes: 1,
          ModelRequestRateLimitCount: 0,
          ModelRequestRateLimitSuccessCount: 1000,
          ModelRequestRateLimitGroup: groupLimits,
        }}
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  client.clear()
})

it.each(['{}', '{"vip":[200,100]}'])(
  'spans both settings columns in visual and JSON modes for %s',
  async (groupLimits) => {
    const user = userEvent.setup()
    renderSection(groupLimits)
    const groupField = screen
      .getByText('Group-based rate limits')
      .closest('[data-slot=form-item]')

    expect(groupField).toHaveAttribute('data-settings-form-span', 'full')
    expect(screen.getByRole('table')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'JSON Mode' }))

    expect(
      screen.getByRole('textbox', { name: 'Group-based rate limits' })
    ).toHaveValue(groupLimits)
    expect(groupField).toHaveAttribute('data-settings-form-span', 'full')
  }
)

it('stacks search and add controls on narrow screens and aligns them on wider screens', () => {
  renderSection()
  const search = screen.getByPlaceholderText('Search group names...')
  const searchContainer = search.parentElement
  const toolbar = searchContainer?.parentElement

  expect(toolbar).toHaveClass('flex-col', 'sm:flex-row')
  expect(toolbar?.parentElement).toHaveClass('min-w-0')
  expect(searchContainer).toHaveClass('min-w-0', 'flex-1')
  expect(screen.getByRole('button', { name: 'Add group' })).toHaveAttribute(
    'type',
    'button'
  )
})
