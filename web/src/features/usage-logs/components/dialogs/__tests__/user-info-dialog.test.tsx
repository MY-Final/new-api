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
import { describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { UserInfoDialog } = await import('../user-info-dialog')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Balance: 'Balance',
        'Invitation Code': 'Invitation Code',
        'Invited Users': 'Invited Users',
        'Inviter ID': 'Inviter ID',
        'Request Count': 'Request Count',
        'Used Quota': 'Used Quota',
        'User Group': 'User Group',
        'User Information': 'User Information',
        Username: 'Username',
      },
    },
  },
})

function renderDialog(user: Record<string, unknown>) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, message: '', data: user },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <UserInfoDialog userId={7} open onOpenChange={() => undefined} />
    </I18nextProvider>
  )
}

const invitedUser = {
  id: 7,
  username: 'qianchuan',
  quota: 0,
  used_quota: 0,
  request_count: 438,
  group: 'paidGroup',
  aff_code: 'D4Fe',
  aff_count: 0,
  inviter_id: 39,
}

describe('usage log user info dialog', () => {
  test('shows who invited an invited user alongside the users they invited', async () => {
    renderDialog(invitedUser)

    expect(await screen.findByText('Inviter ID')).toBeVisible()
    expect(screen.getByText('39')).toBeVisible()
    // The two invitation directions stay distinct: the invited count is not
    // replaced by the inviter, and the inviter is not rendered as a count.
    expect(screen.getByText('Invited Users')).toBeVisible()
    expect(screen.getByText('0')).toBeVisible()
  })

  test('renders the invitation section when only the inviter is recorded', async () => {
    renderDialog({
      id: 8,
      username: 'invitee',
      quota: 0,
      used_quota: 0,
      request_count: 0,
      inviter_id: 39,
    })

    expect(await screen.findByText('Inviter ID')).toBeVisible()
    expect(screen.getByText('39')).toBeVisible()
    expect(screen.queryByText('Invited Users')).not.toBeInTheDocument()
  })

  test('hides the inviter when the account was not invited', async () => {
    renderDialog({ ...invitedUser, inviter_id: 0 })

    expect(await screen.findByText('Invited Users')).toBeVisible()
    expect(screen.queryByText('Inviter ID')).not.toBeInTheDocument()
  })
})
