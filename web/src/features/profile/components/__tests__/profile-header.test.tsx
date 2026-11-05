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
import { beforeEach, describe, expect, test } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { UserProfile } from '../../types'
import { ProfileHeader } from '../profile-header'

const profile: UserProfile = {
  id: 53,
  username: 'final_test',
  display_name: 'Demo Account',
  role: 1,
  group: 'default',
  quota: 3_020_000,
  used_quota: 100,
  wallet_used_quota: 40,
  subscription_used_quota: 60,
  request_count: 5,
  wallet_request_count: 2,
  subscription_request_count: 3,
  status: 1,
  aff_count: 0,
  aff_quota: 0,
  aff_history_quota: 0,
  aff_reversed_quota: 0,
  created_time: 1_700_000_000,
}

describe('ProfileHeader usage split', () => {
  beforeEach(() => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG },
    })
  })

  test('shows wallet and subscription usage as separate stats', () => {
    render(<ProfileHeader profile={profile} loading={false} />)

    expect(screen.getByText('Wallet Usage')).toBeVisible()
    expect(screen.getByText('Subscription Usage')).toBeVisible()
    expect(screen.getByText('40% of total usage')).toBeVisible()
    expect(screen.getByText('60% of total usage')).toBeVisible()
    expect(screen.getByText('Wallet: 2 · Subscription: 3')).toBeVisible()
  })
})
