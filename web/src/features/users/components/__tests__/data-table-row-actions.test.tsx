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
import type { Row } from '@tanstack/react-table'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import type { User } from '../../types'
import { DataTableRowActions } from '../data-table-row-actions'
import { UsersProvider } from '../users-provider'

vi.mock('../dialogs/user-binding-dialog', () => ({
  UserBindingDialog: () => null,
}))

vi.mock(
  '@/features/subscriptions/components/dialogs/user-subscriptions-dialog',
  () => ({
    UserSubscriptionsDialog: () => null,
  })
)

vi.mock('../dialogs/user-usage-dialog', () => ({
  UserUsageDialog: (props: { open: boolean; userId: number }) =>
    props.open ? (
      <div data-testid='user-usage-dialog'>User {props.userId}</div>
    ) : null,
}))

const user: User = {
  id: 7,
  username: 'usage-user',
  display_name: 'Usage User',
  quota: 1000,
  used_quota: 0,
  request_count: 0,
  group: 'default',
  status: 1,
  role: 1,
}

describe('DataTableRowActions usage details', () => {
  test('opens usage details for the selected user from the action menu', () => {
    render(
      <UsersProvider>
        <DataTableRowActions row={{ original: user } as Row<User>} />
      </UsersProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Usage Details' }))

    expect(screen.getByTestId('user-usage-dialog')).toHaveTextContent('User 7')
  })
})
