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
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { getUserUsage } from '../../../api'
import { UserUsageDialog } from '../user-usage-dialog'

vi.mock('../../../api', () => ({
  getUserUsage: vi.fn(),
}))

vi.mock('@/lib/use-chart-theme', () => ({
  useChartTheme: () => ({ resolvedTheme: 'light', themeReady: true }),
}))

vi.mock('@visactor/react-vchart', () => ({
  VChart: () => null,
}))

const getUserUsageMock = vi.mocked(getUserUsage)
const originalGetAnimations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

const usageData = {
  user: {
    id: 7,
    username: 'usage-user',
    display_name: 'Usage User',
    quota: 900,
    used_quota: 700,
    request_count: 12,
  },
  summary: {
    request_count: 2,
    prompt_tokens: 300,
    completion_tokens: 150,
    total_tokens: 450,
    consumed_quota: 400,
    refunded_quota: 50,
    net_quota: 350,
  },
  daily: [
    {
      day: '2025-01-10',
      request_count: 2,
      prompt_tokens: 300,
      completion_tokens: 150,
      total_tokens: 450,
      consumed_quota: 400,
      refunded_quota: 50,
      net_quota: 350,
    },
  ],
  models: [
    {
      model_name: 'model-a',
      request_count: 2,
      prompt_tokens: 300,
      completion_tokens: 150,
      total_tokens: 450,
      consumed_quota: 400,
      refunded_quota: 50,
      net_quota: 350,
    },
  ],
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <UserUsageDialog
        open
        userId={7}
        username='usage-user'
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (originalGetAnimations) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      originalGetAnimations
    )
    return
  }
  Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
})

describe('UserUsageDialog', () => {
  test('requests the selected user and renders usage aggregates', async () => {
    getUserUsageMock.mockResolvedValue({ success: true, data: usageData })

    renderDialog()

    expect(await screen.findByText('model-a')).toBeInTheDocument()
    expect(screen.getByText('Period Summary')).toBeInTheDocument()
    expect(screen.getAllByText('Prompt Tokens').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Refunded Quota').length).toBeGreaterThan(0)
    expect(getUserUsageMock).toHaveBeenCalledWith(
      7,
      expect.any(Number),
      expect.any(Number)
    )
  })

  test('requeries after changing the date range and blocks ranges over 31 days', async () => {
    getUserUsageMock.mockResolvedValue({ success: true, data: usageData })

    renderDialog()
    await screen.findByText('model-a')
    const initialCallCount = getUserUsageMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /~/ }))
    const dateInputs = screen.getAllByDisplayValue(/T/)
    fireEvent.change(dateInputs[0], { target: { value: '2025-01-01T00:00' } })
    fireEvent.change(dateInputs[1], { target: { value: '2025-03-01T00:00' } })
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()

    fireEvent.change(dateInputs[1], { target: { value: '2025-01-20T00:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(getUserUsageMock.mock.calls.length).toBeGreaterThan(
        initialCallCount
      )
    })
    const lastCall = getUserUsageMock.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe(7)
    expect(lastCall?.[1]).toBe(
      Math.floor(new Date('2025-01-01T00:00').getTime() / 1000)
    )
  })

  test('shows a retryable error when the usage request fails', async () => {
    getUserUsageMock.mockRejectedValue(new Error('request failed'))

    renderDialog()

    expect(
      await screen.findByText('Failed to load usage details')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
