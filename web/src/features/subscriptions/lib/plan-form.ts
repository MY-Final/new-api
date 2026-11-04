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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import type { SubscriptionPlan, PlanPayload } from '../types'

export interface PlanQuotaWindowFormValue {
  window_seconds: number
  quota_amount: number
}

export function getPlanFormSchema(t: TFunction) {
  return z
    .object({
      title: z.string().min(1, t('Please enter plan title')),
      subtitle: z.string().optional(),
      price_amount: z.coerce.number().min(0, t('Please enter amount')),
      currency: z.string().min(3),
      duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
      duration_value: z.coerce.number().min(1),
      custom_seconds: z.coerce.number().min(0).optional(),
      quota_reset_period: z.enum([
        'never',
        'daily',
        'weekly',
        'monthly',
        'custom',
      ]),
      quota_reset_custom_seconds: z.coerce.number().min(0).optional(),
      enabled: z.boolean(),
      sort_order: z.coerce.number(),
      allow_balance_pay: z.boolean(),
      allow_wallet_overflow: z.boolean(),
      max_purchase_per_user: z.coerce.number().min(0),
      max_concurrency: z.coerce.number().int().min(0),
      total_amount: z.coerce.number().min(0),
      quota_windows: z
        .array(
          z.object({
            _key: z.string().optional(),
            window_seconds: z.coerce.number().int().min(1),
            quota_amount: z.coerce.number().positive(),
          })
        )
        .max(8),
      upgrade_group: z.string().optional(),
      route_groups: z
        .array(z.string().trim().min(1))
        .min(1, t('Select at least one allowed route group'))
        .max(32),
      downgrade_group: z.string().optional(),
      stripe_price_id: z.string().optional(),
      creem_product_id: z.string().optional(),
      waffo_pancake_product_id: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      const seen = new Set<number>()
      for (const [index, window] of value.quota_windows.entries()) {
        if (seen.has(window.window_seconds)) {
          ctx.addIssue({
            code: 'custom',
            path: ['quota_windows', index, 'window_seconds'],
            message: t('Window durations must be unique'),
          })
        }
        seen.add(window.window_seconds)
      }
    })
}

export type PlanFormValues = z.infer<ReturnType<typeof getPlanFormSchema>>

export const PLAN_FORM_DEFAULTS: PlanFormValues = {
  title: '',
  subtitle: '',
  price_amount: 0,
  currency: 'CNY',
  duration_unit: 'month',
  duration_value: 1,
  custom_seconds: 0,
  quota_reset_period: 'never',
  quota_reset_custom_seconds: 0,
  enabled: true,
  sort_order: 0,
  allow_balance_pay: true,
  allow_wallet_overflow: true,
  max_purchase_per_user: 0,
  max_concurrency: 0,
  total_amount: 0,
  quota_windows: [],
  upgrade_group: '',
  route_groups: [],
  downgrade_group: '',
  stripe_price_id: '',
  creem_product_id: '',
  waffo_pancake_product_id: '',
}

export function planToFormValues(plan: SubscriptionPlan): PlanFormValues {
  return {
    title: plan.title || '',
    subtitle: plan.subtitle || '',
    price_amount: Number(plan.price_amount || 0),
    currency: plan.currency || 'CNY',
    duration_unit: plan.duration_unit || 'month',
    duration_value: Number(plan.duration_value || 1),
    custom_seconds: Number(plan.custom_seconds || 0),
    quota_reset_period: plan.quota_reset_period || 'never',
    quota_reset_custom_seconds: Number(plan.quota_reset_custom_seconds || 0),
    enabled: plan.enabled !== false,
    sort_order: Number(plan.sort_order || 0),
    allow_balance_pay: plan.allow_balance_pay !== false,
    allow_wallet_overflow: plan.allow_wallet_overflow !== false,
    max_purchase_per_user: Number(plan.max_purchase_per_user || 0),
    max_concurrency: Number(plan.max_concurrency || 0),
    total_amount: quotaUnitsToDollars(Number(plan.total_amount || 0)),
    quota_windows: (plan.quota_windows || []).map((window) => ({
      _key: crypto.randomUUID(),
      window_seconds: Number(window.window_seconds || 0),
      quota_amount: quotaUnitsToDollars(Number(window.quota_limit || 0)),
    })),
    upgrade_group: plan.upgrade_group || '',
    route_groups: [...new Set(plan.route_groups || [])],
    downgrade_group: plan.downgrade_group || '',
    stripe_price_id: plan.stripe_price_id || '',
    creem_product_id: plan.creem_product_id || '',
    waffo_pancake_product_id: plan.waffo_pancake_product_id || '',
  }
}

export function formValuesToPlanPayload(values: PlanFormValues): PlanPayload {
  return {
    plan: {
      ...values,
      price_amount: Number(values.price_amount || 0),
      currency: values.currency || 'CNY',
      duration_value: Number(values.duration_value || 0),
      custom_seconds: Number(values.custom_seconds || 0),
      quota_reset_period: values.quota_reset_period || 'never',
      quota_reset_custom_seconds:
        values.quota_reset_period === 'custom'
          ? Number(values.quota_reset_custom_seconds || 0)
          : 0,
      sort_order: Number(values.sort_order || 0),
      max_purchase_per_user: Number(values.max_purchase_per_user || 0),
      max_concurrency: Number(values.max_concurrency || 0),
      total_amount: parseQuotaFromDollars(Number(values.total_amount || 0)),
      quota_windows: values.quota_windows.map((window, index) => ({
        window_seconds: Number(window.window_seconds || 0),
        quota_limit: parseQuotaFromDollars(Number(window.quota_amount || 0)),
        sort_order: index,
      })),
      allow_wallet_overflow:
        values.quota_windows.length > 0 ? false : values.allow_wallet_overflow,
      upgrade_group: values.upgrade_group || '',
      route_groups: [
        ...new Set(
          values.route_groups.map((group) => group.trim()).filter(Boolean)
        ),
      ],
      downgrade_group: values.downgrade_group || '',
    },
  }
}
