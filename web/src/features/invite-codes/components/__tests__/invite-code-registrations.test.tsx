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
*/
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { getInviteCodeClaims } from '../../api'
import type { InviteCode } from '../../types'
import { InviteCodeClaimsDialog } from '../invite-code-claims-dialog'
import { InviteCodeRegistrationsCell } from '../invite-code-registrations-cell'

vi.mock('../../api', () => ({
  getInviteCodeClaims: vi.fn(),
}))

const inviteCode: InviteCode = {
  id: 7,
  name: 'Magpie',
  code: 'magpie',
  enabled: true,
  group: 'free',
  inviter_id: 0,
  registration_limit: 100,
  registered_count: 12,
  remaining_registrations: 88,
  bonus_quota: 500000,
  expires_at: 0,
  remark: '',
  created_at: 1,
  updated_at: 1,
}

test('opens registrations directly from the registration count', async () => {
  const onOpen = vi.fn()
  const user = userEvent.setup()

  render(
    <InviteCodeRegistrationsCell
      code={inviteCode}
      locale='en'
      onOpen={onOpen}
    />
  )

  expect(screen.getByText('12 / 100')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View registrations' }))
  expect(onOpen).toHaveBeenCalledOnce()
})

test('shows the users attributed to an invitation code', async () => {
  vi.mocked(getInviteCodeClaims).mockResolvedValue({
    success: true,
    data: {
      page: 1,
      page_size: 20,
      total: 1,
      items: [
        {
          user_id: 42,
          username: 'magpie-user',
          display_name: 'Magpie User',
          email: 'magpie@example.test',
          group: 'free',
          inviter_id: 0,
          bonus_quota: 500000,
          user_status: 1,
          user_created_at: 1,
          claimed_at: 1,
        },
      ],
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <InviteCodeClaimsDialog code={inviteCode} open onOpenChange={vi.fn()} />
    </QueryClientProvider>
  )

  expect(await screen.findByText('Magpie User')).toBeInTheDocument()
  expect(screen.getByText('@magpie-user')).toBeInTheDocument()
  expect(screen.getByText('magpie@example.test')).toBeInTheDocument()
  await waitFor(() =>
    expect(getInviteCodeClaims).toHaveBeenCalledWith(7, 1, 20)
  )
})
