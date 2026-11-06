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
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  FreeGroupUsage,
  FreeGroupUsageIndicator,
} from '../components/free-group-usage'

afterEach(cleanup)

describe('free group usage', () => {
  it('shows the public daily count, group, and remaining calls when enabled', () => {
    render(
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

  it('shows a disabled state without a progress bar when the free group is off', () => {
    render(
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

    const usage = screen.getByRole('region', {
      name: 'Free group calls today',
    })
    expect(within(usage).getByText('Disabled')).toBeVisible()
    expect(within(usage).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows an unavailable state when the public usage request fails', () => {
    render(<FreeGroupUsage usage={undefined} isLoading={false} isError />)

    expect(screen.getByText('Unavailable')).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows the public daily count in the compact header indicator', () => {
    render(
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

  it('shows the disabled state in the compact header indicator', () => {
    render(
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

    expect(screen.getByText('Disabled')).toBeVisible()
  })
})
