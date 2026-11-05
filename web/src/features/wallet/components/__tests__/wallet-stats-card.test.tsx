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
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { UserWalletData } from '../../types'
import { WalletStatsCard } from '../wallet-stats-card'

const user: UserWalletData = {
  id: 1,
  username: 'wallet-user',
  quota: 100,
  used_quota: 0,
  request_count: 0,
  aff_quota: 0,
  aff_history_quota: 0,
  aff_reversed_quota: 0,
  aff_count: 0,
  affiliate_topup_rebate_rate: 0,
  affiliate_redemption_rebate_rate: 0,
  group: 'default',
}

describe('WalletStatsCard balance state', () => {
  beforeEach(() => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG },
    })
  })

  test('shows debt label and absolute debt amount for a negative balance', () => {
    render(<WalletStatsCard user={{ ...user, quota: -100 }} />)

    expect(screen.getByText('Debt')).toBeInTheDocument()
    expect(screen.getByText('Recharge to settle debt')).toBeInTheDocument()
    expect(screen.getByText('🥚 0.0002')).toBeInTheDocument()
  })

  test('shows fractional currency precisely for a positive balance', () => {
    render(<WalletStatsCard user={{ ...user, quota: 999999 }} />)

    expect(screen.getByText('Current Balance')).toBeInTheDocument()
    expect(screen.getByText('🥚 1.999998')).toBeInTheDocument()
    expect(screen.queryByText('Debt')).not.toBeInTheDocument()
  })

  test('separates wallet usage, subscription usage, and their request counts', () => {
    render(
      <WalletStatsCard
        user={{
          ...user,
          used_quota: 100,
          wallet_used_quota: 40,
          subscription_used_quota: 60,
          request_count: 10,
          wallet_request_count: 4,
          subscription_request_count: 6,
        }}
      />
    )

    expect(screen.getByText('Wallet Usage')).toBeInTheDocument()
    expect(screen.getByText('Subscription Usage')).toBeInTheDocument()
    expect(screen.getByText('Consumed from wallet')).toBeInTheDocument()
    expect(screen.getByText('Consumed from subscriptions')).toBeInTheDocument()
    expect(screen.getByText('Wallet: 4 · Subscription: 6')).toBeInTheDocument()
  })
})
