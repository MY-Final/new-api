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
import { describe, expect, it } from 'vitest'

import type { UserUsageModel } from '../../types'
import { ModelUsageTable } from '../usage-overview'

const emptyMetrics: Omit<UserUsageModel, 'model_name'> = {
  request_count: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 0,
  consumed_quota: 0,
  refunded_quota: 0,
  net_quota: 0,
  user_cost: 0,
}

const models: UserUsageModel[] = [
  {
    ...emptyMetrics,
    model_name: 'alpha',
    request_count: 5,
    total_tokens: 50,
    user_cost: 6,
  },
  {
    ...emptyMetrics,
    model_name: 'beta',
    request_count: 10,
    total_tokens: 900,
    user_cost: 3,
  },
  {
    ...emptyMetrics,
    model_name: 'gamma',
    request_count: 30,
    total_tokens: 100,
    user_cost: 1,
  },
]

function modelOrder(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent ?? '')
}

describe('ModelUsageTable', () => {
  it('ranks models by cost by default and shows each share of the total', () => {
    render(<ModelUsageTable data={models} />)

    expect(modelOrder()[0]).toContain('alpha')
    expect(modelOrder()[2]).toContain('gamma')
    expect(screen.getByText(/60\s*%/)).toBeInTheDocument()
  })

  it('reorders rows when another ranking metric is selected', async () => {
    const user = userEvent.setup()
    render(<ModelUsageTable data={models} />)

    await user.click(screen.getByRole('tab', { name: 'Tokens' }))
    expect(modelOrder()[0]).toContain('beta')
    expect(modelOrder()[2]).toContain('alpha')

    await user.click(screen.getByRole('tab', { name: 'Requests' }))
    expect(modelOrder()[0]).toContain('gamma')
    expect(modelOrder()[2]).toContain('alpha')
  })
})
