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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { AffiliateRewardsCard } from '../affiliate-rewards-card'

const user = {
  id: 1,
  username: 'inviter',
  quota: 0,
  used_quota: 0,
  request_count: 0,
  aff_quota: 500,
  aff_history_quota: 1000,
  aff_reversed_quota: 0,
  aff_count: 3,
  affiliate_topup_rebate_rate: 1000,
  affiliate_redemption_rebate_rate: 500,
  group: 'default',
}

describe('AffiliateRewardsCard', () => {
  test('separates stats and actions for responsive layout', () => {
    const view = render(
      <I18nextProvider i18n={i18next}>
        <AffiliateRewardsCard
          user={user}
          affiliateLink='https://example.com/register?aff=code'
          onTransfer={vi.fn()}
          onViewLedger={vi.fn()}
          onViewInvitees={vi.fn()}
        />
      </I18nextProvider>
    )

    const stats = view.container.querySelector(
      '[data-slot="affiliate-rewards-stats"]'
    )
    const actions = view.container.querySelector(
      '[data-slot="affiliate-rewards-actions"]'
    )

    expect(stats).toHaveClass('grid-cols-2', 'sm:grid-cols-4')
    expect(actions).toHaveClass('flex-col', 'sm:flex-row')
    expect(
      screen.getByDisplayValue('https://example.com/register?aff=code')
    ).toHaveClass('text-center')
  })

  test('shows both rebate rates and opens invite details', async () => {
    const onViewInvitees = vi.fn()
    const view = render(
      <I18nextProvider i18n={i18next}>
        <AffiliateRewardsCard
          user={user}
          affiliateLink='https://example.com/register?aff=code'
          onTransfer={vi.fn()}
          onViewLedger={vi.fn()}
          onViewInvitees={onViewInvitees}
        />
      </I18nextProvider>
    )
    const userEventSetup = userEvent.setup()

    expect(view.getByText('Top-up rebate: 10%')).toBeInTheDocument()
    expect(view.getByText('Paid-code rebate: 5%')).toBeInTheDocument()
    expect(view.getByText('3')).toBeInTheDocument()

    await userEventSetup.click(
      screen.getByRole('button', { name: 'Invite Details' })
    )
    expect(onViewInvitees).toHaveBeenCalledOnce()
  })
})
