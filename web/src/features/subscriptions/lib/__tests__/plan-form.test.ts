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
import i18next from 'i18next'
import { describe, expect, test } from 'vitest'

import {
  formValuesToPlanPayload,
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
} from '../plan-form'

const schema = getPlanFormSchema(i18next.t)

function validPlanValues() {
  return {
    ...PLAN_FORM_DEFAULTS,
    title: 'DeepSeek Day Pass',
    price_amount: 6,
    quota_windows: [{ window_seconds: 5 * 60 * 60, quota_amount: 1 }],
  }
}

describe('subscription plan form', () => {
  test('defaults new plans to CNY with no concurrency limit', () => {
    const parsed = schema.parse({
      ...PLAN_FORM_DEFAULTS,
      title: 'New plan',
    })

    expect(parsed.currency).toBe('CNY')
    expect(parsed.max_concurrency).toBe(0)
    expect(parsed.quota_windows).toEqual([])
  })

  test('rejects duplicate window durations and non-positive quotas', () => {
    const duplicate = schema.safeParse({
      ...validPlanValues(),
      quota_windows: [
        { window_seconds: 3600, quota_amount: 1 },
        { window_seconds: 3600, quota_amount: 2 },
      ],
    })
    expect(duplicate.success).toBe(false)

    const nonPositive = schema.safeParse({
      ...validPlanValues(),
      quota_windows: [{ window_seconds: 3600, quota_amount: 0 }],
    })
    expect(nonPositive.success).toBe(false)
  })

  test('snapshots window plans without wallet overflow and preserves concurrency', () => {
    const payload = formValuesToPlanPayload({
      ...validPlanValues(),
      max_concurrency: 2,
      allow_wallet_overflow: true,
    })

    expect(payload.plan.max_concurrency).toBe(2)
    expect(payload.plan.allow_wallet_overflow).toBe(false)
    expect(payload.plan.quota_windows).toEqual([
      {
        window_seconds: 5 * 60 * 60,
        quota_limit: expect.any(Number),
        sort_order: 0,
      },
    ])
  })
})
