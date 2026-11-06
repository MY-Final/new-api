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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { createInviteCode } from '../../api'
import { InviteCodesMutateDrawer } from '../invite-codes-mutate-drawer'

vi.mock('@/features/users/api', () => ({
  getGroups: vi.fn(),
}))

vi.mock('../../api', () => ({
  createInviteCode: vi.fn(),
  updateInviteCode: vi.fn(),
}))

afterEach(() => {
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

test('selects the registration group from existing groups', async () => {
  const { getGroups } = await import('@/features/users/api')
  vi.mocked(getGroups).mockResolvedValue({
    success: true,
    data: ['free', 'premium'],
  })
  vi.mocked(createInviteCode).mockResolvedValue({
    success: true,
    data: {
      id: 1,
      name: 'Magpie',
      code: 'magpie',
      enabled: true,
      group: 'free',
      inviter_id: 0,
      registration_limit: 100,
      registered_count: 0,
      remaining_registrations: 100,
      bonus_quota: 0,
      expires_at: 0,
      remark: '',
      created_at: 1,
      updated_at: 1,
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()

  render(
    <QueryClientProvider client={client}>
      <InviteCodesMutateDrawer
        open
        onOpenChange={vi.fn()}
        currentRow={null}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>
  )

  const group = await screen.findByRole('combobox', {
    name: 'Registration group',
  })
  expect(group.tagName).toBe('INPUT')
  await user.click(screen.getByRole('button', { name: 'Open' }))
  expect(await screen.findByRole('option', { name: 'free' })).toBeVisible()
  expect(screen.queryByRole('option', { name: 'auto' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: 'free' }))

  await user.type(
    screen.getByRole('textbox', { name: 'Campaign name' }),
    'Magpie'
  )
  await user.click(
    screen.getByRole('button', { name: 'Create invitation code' })
  )

  await waitFor(() =>
    expect(createInviteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Magpie',
        group: 'free',
        registration_limit: 100,
      })
    )
  )
})

test('shows the custom currency and converts the bonus to quota units', async () => {
  const { getGroups } = await import('@/features/users/api')
  vi.mocked(getGroups).mockResolvedValue({
    success: true,
    data: ['free'],
  })
  vi.mocked(createInviteCode).mockResolvedValue({
    success: true,
    data: {
      id: 1,
      name: 'Magpie',
      code: 'magpie',
      enabled: true,
      group: 'free',
      inviter_id: 0,
      registration_limit: 100,
      registered_count: 0,
      remaining_registrations: 100,
      bonus_quota: 500000,
      expires_at: 0,
      remark: '',
      created_at: 1,
      updated_at: 1,
    },
  })
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: 'CUSTOM',
      quotaPerUnit: 500000,
      customCurrencySymbol: '🥚',
      customCurrencyExchangeRate: 1,
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const user = userEvent.setup()

  render(
    <QueryClientProvider client={client}>
      <InviteCodesMutateDrawer
        open
        onOpenChange={vi.fn()}
        currentRow={null}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>
  )

  await screen.findByRole('combobox', { name: 'Registration group' })
  await user.click(screen.getByRole('button', { name: 'Open' }))
  await user.click(await screen.findByRole('option', { name: 'free' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Campaign name' }),
    'Magpie'
  )
  await user.type(
    screen.getByRole('spinbutton', { name: 'Registration bonus (🥚)' }),
    '1'
  )
  await user.click(
    screen.getByRole('button', { name: 'Create invitation code' })
  )

  await waitFor(() =>
    expect(createInviteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        bonus_quota: 500000,
      })
    )
  )
})
