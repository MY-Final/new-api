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
import { createInstance } from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'

import {
  applyFinancePenalty,
  refundFinanceTopup,
  reverseFinancePenalty,
} from '../api'

vi.mock('@/lib/api', () => ({
  api: { post: vi.fn() },
}))

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en } })

afterEach(() => {
  vi.mocked(api.post).mockReset()
})

it('rejects a refused refund so the console cannot report success', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: false,
      message: 'Redemption is not refundable',
      message_key: 'Redemption is not refundable',
    },
  })

  await expect(refundFinanceTopup('trade-1', 'wrong order')).rejects.toThrow(
    'Redemption is not refundable'
  )
})

it('rejects refused penalties and reversals with the server reason', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: {
      success: false,
      message: 'Cannot operate on a user with the same or higher role',
      message_key:
        'Cannot operate on a user with the same or higher role',
    },
  })

  await expect(
    applyFinancePenalty(7, 100, 'abuse', 'req-1')
  ).rejects.toThrow('Cannot operate on a user with the same or higher role')
  await expect(reverseFinancePenalty(9, 'appeal')).rejects.toThrow(
    'Cannot operate on a user with the same or higher role'
  )
})

it('returns the payload of an accepted operation', async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { success: true, data: { already_refunded: false } },
  })

  await expect(refundFinanceTopup('trade-2', 'duplicate charge')).resolves.toEqual(
    { success: true, data: { already_refunded: false } }
  )
})
