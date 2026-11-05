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
    route_groups: ['deepseek-a'],
    quota_windows: [{ window_seconds: 5 * 60 * 60, quota_amount: 1 }],
  }
}

describe('subscription plan form', () => {
  test('defaults new plans to CNY with no concurrency limit', () => {
    const parsed = schema.parse({
      ...PLAN_FORM_DEFAULTS,
      title: 'New plan',
      route_groups: ['deepseek-a'],
    })

    expect(parsed.currency).toBe('CNY')
    expect(parsed.max_concurrency).toBe(0)
    expect(parsed.max_output_tokens).toBe(4096)
    expect(parsed.quota_windows).toEqual([])
    expect(parsed.route_groups).toEqual(['deepseek-a'])
  })

  test('requires at least one subscription route group', () => {
    const result = schema.safeParse({
      ...PLAN_FORM_DEFAULTS,
      title: 'New plan',
    })

    expect(result.success).toBe(false)
  })

  test('allows paid plans with unlimited quota and requires a positive output token limit', () => {
    expect(
      schema.safeParse({
        ...validPlanValues(),
        quota_windows: [],
        total_amount: 0,
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({
        ...validPlanValues(),
        quota_windows: [],
        total_amount: 10,
      }).success
    ).toBe(true)
    for (const limit of [0, -1, 1.5, 1_073_741_824]) {
      expect(
        schema.safeParse({
          ...validPlanValues(),
          max_output_tokens: limit,
        }).success
      ).toBe(false)
    }
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

  test('preserves route ratios, wallet fallback, and concurrency', () => {
    const payload = formValuesToPlanPayload({
      ...validPlanValues(),
      route_groups: ['deepseek-a', 'deepseek-b'],
      route_group_ratios: {
        'deepseek-a': 1,
        'deepseek-b': 0.2,
      },
      max_concurrency: 2,
      max_output_tokens: 8192,
      allow_wallet_overflow: true,
    })

    expect(payload.plan.max_concurrency).toBe(2)
    expect(payload.plan.max_output_tokens).toBe(8192)
    expect(payload.plan.route_groups).toEqual(['deepseek-a', 'deepseek-b'])
    expect(payload.plan.route_group_ratios).toEqual({
      'deepseek-a': 1,
      'deepseek-b': 0.2,
    })
    expect(payload.plan.allow_wallet_overflow).toBe(true)
    expect(payload.plan.quota_windows).toEqual([
      {
        window_seconds: 5 * 60 * 60,
        quota_limit: expect.any(Number),
        sort_order: 0,
      },
    ])
  })

  test('rejects a negative subscription route multiplier', () => {
    expect(
      schema.safeParse({
        ...validPlanValues(),
        route_group_ratios: { 'deepseek-a': -0.1 },
      }).success
    ).toBe(false)
  })
})
