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
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  FreeGroupUsage,
  FreeGroupUsageIndicator,
} from '../components/free-group-usage'

afterEach(cleanup)

function renderWithQueryClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

describe('free group usage', () => {
  it('shows the public daily count, group, and remaining calls when enabled', () => {
    renderWithQueryClient(
      <FreeGroupUsage
        usage={{
          enabled: true,
          group: 'free-eggs',
          daily_limit: 10000,
          used: 1234,
          remaining: 8766,
        }}
        isLoading={false}
        isError={false}
      />
    )

    const usage = screen.getByRole('region', {
      name: 'Free group calls today',
    })
    expect(within(usage).getByText('free-eggs')).toBeVisible()
    expect(within(usage).getByText('Remaining today: 8,766')).toBeVisible()
    expect(within(usage).getByText(/1,234/)).toBeVisible()
    expect(
      within(usage).getByRole('progressbar', {
        name: 'Progress for free group calls',
      })
    ).toBeVisible()
  })

  it('renders nothing when the free group is off', () => {
    renderWithQueryClient(
      <FreeGroupUsage
        usage={{
          enabled: false,
          group: '',
          daily_limit: 10000,
          used: 0,
          remaining: 10000,
        }}
        isLoading={false}
        isError={false}
      />
    )

    expect(
      screen.queryByRole('region', {
        name: 'Free group calls today',
      })
    ).not.toBeInTheDocument()
  })

  it('shows an unavailable state when the public usage request fails', () => {
    renderWithQueryClient(
      <FreeGroupUsage usage={undefined} isLoading={false} isError />
    )

    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows the public daily count in the compact header indicator', () => {
    renderWithQueryClient(
      <FreeGroupUsageIndicator
        usage={{
          enabled: true,
          group: 'free-eggs',
          daily_limit: 10000,
          used: 1234,
          remaining: 8766,
        }}
        isLoading={false}
        isError={false}
      />
    )

    expect(
      screen.getByLabelText(
        'Free group calls today: free-eggs, 1,234 / 10,000, Remaining today: 8,766'
      )
    ).toBeVisible()
  })

  it('renders no compact indicator when the free group is off', () => {
    renderWithQueryClient(
      <FreeGroupUsageIndicator
        usage={{
          enabled: false,
          group: '',
          daily_limit: 10000,
          used: 0,
          remaining: 10000,
        }}
        isLoading={false}
        isError={false}
      />
    )

    expect(screen.queryByText('Disabled')).not.toBeInTheDocument()
  })
})
