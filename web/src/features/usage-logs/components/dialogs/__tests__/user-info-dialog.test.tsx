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
const { formatQuota, formatTimestampToDate } = await import('@/lib/format')
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
        'Affiliate Code': 'Affiliate Code',
        'Historical Affiliate Quota': 'Historical Affiliate Quota',
        'Reversed Affiliate Quota': 'Reversed Affiliate Quota',
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

function infoValue(label: string) {
  const labelElement = screen.getByText(label, { selector: 'dt' })
  const value = labelElement.parentElement?.querySelector('dd')
  if (!value) {
    throw new Error(`Missing value for ${label}`)
  }
  return value
}

const invitedUser = {
  id: 7,
  username: 'qianchuan',
  email: 'qianchuan@example.test',
  status: 1,
  role: 100,
  quota: 0,
  bonus_quota: 500000,
  paid_quota: 0,
  used_quota: 0,
  request_count: 438,
  group: 'paidGroup',
  max_concurrency: 0,
  aff_code: 'D4Fe',
  aff_count: 0,
  aff_quota: 250000,
  aff_history_quota: 1000000,
  aff_reversed_quota: 500000,
  inviter_id: 39,
  created_at: 1_790_000_000,
  last_login_at: 1_790_100_000,
  github_id: 'github-7',
  linux_do_id: 'linuxdo-7',
  remark: 'VIP account',
}

describe('usage log user info dialog', () => {
  test('shows account, wallet, referral, and binding details', async () => {
    renderDialog(invitedUser)

    expect(await screen.findByText('qianchuan@example.test')).toBeVisible()
    expect(screen.getByText('Super Admin')).toBeVisible()
    expect(screen.getByText('Enabled')).toBeVisible()
    expect(
      screen.getByText(formatTimestampToDate(invitedUser.created_at))
    ).toBeVisible()
    expect(
      screen.getByText(formatTimestampToDate(invitedUser.last_login_at))
    ).toBeVisible()
    expect(screen.getByText('Bonus Balance')).toBeVisible()
    expect(infoValue('Bonus Balance')).toHaveTextContent(
      formatQuota(invitedUser.bonus_quota)
    )
    expect(screen.getByText('Affiliate Code')).toBeVisible()
    expect(screen.getByText('D4Fe')).toBeVisible()
    expect(screen.getByText('Historical Affiliate Quota')).toBeVisible()
    expect(screen.getByText('Reversed Affiliate Quota')).toBeVisible()
    expect(screen.getByText('github-7')).toBeVisible()
    expect(screen.getByText('linuxdo-7')).toBeVisible()
    expect(screen.getByText('VIP account')).toBeVisible()
  })

  test('shows who invited an invited user alongside the users they invited', async () => {
    renderDialog(invitedUser)

    expect(await screen.findByText('Inviter ID')).toBeVisible()
    expect(infoValue('Inviter ID')).toHaveTextContent('39')
    // The two invitation directions stay distinct: the invited count is not
    // replaced by the inviter, and the inviter is not rendered as a count.
    expect(screen.getByText('Invited Users')).toBeVisible()
    expect(infoValue('Invited Users')).toHaveTextContent('0')
  })

  test('renders the full referral section for a user without referral data', async () => {
    renderDialog({
      id: 8,
      username: 'invitee',
      status: 1,
      role: 1,
      quota: 0,
      used_quota: 0,
      request_count: 0,
    })

    expect(await screen.findByText('Inviter ID')).toBeVisible()
    expect(infoValue('Inviter ID')).toHaveTextContent('-')
    expect(infoValue('Invited Users')).toHaveTextContent('-')
  })

  test('hides the inviter when the account was not invited', async () => {
    renderDialog({ ...invitedUser, inviter_id: 0 })

    expect(await screen.findByText('Invited Users')).toBeVisible()
    expect(infoValue('Inviter ID')).toHaveTextContent('-')
  })
})
