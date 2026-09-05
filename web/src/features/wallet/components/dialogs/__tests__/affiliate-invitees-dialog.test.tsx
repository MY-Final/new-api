/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { AffiliateInviteesDialog } from '../affiliate-invitees-dialog'

const getAffiliateInvitees = vi.hoisted(() => vi.fn())

vi.mock('../../../api', () => ({ getAffiliateInvitees }))

describe('AffiliateInviteesDialog', () => {
  test('renders invitee identity, rebate total, and registration time', async () => {
    getAffiliateInvitees.mockResolvedValue({
      data: {
        items: [
          {
            id: 2,
            username: 'invitee',
            email: '***@example.com',
            created_at: 1,
            rebate_quota: 100,
            reversed_quota: 0,
          },
        ],
        total: 1,
      },
    })

    render(
      <I18nextProvider i18n={i18next}>
        <AffiliateInviteesDialog open onOpenChange={vi.fn()} />
      </I18nextProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('***@example.com')).toBeInTheDocument()
    })
    expect(screen.getByText('invitee')).toBeInTheDocument()
    expect(screen.getByText(/1970-01-01/)).toBeInTheDocument()
    expect(getAffiliateInvitees).toHaveBeenCalledWith(1, 10)
  })
})
