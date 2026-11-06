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

import { normalizeInviteCode } from '@/features/auth/lib/invite-code'
import { getCurrencyDisplay } from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToEditableAmount } from '@/lib/format'

import type { InviteCode, InviteCodePayload } from '../types'

export const INVITE_CODE_FORM_DEFAULTS = {
  name: '',
  code: '',
  enabled: true,
  group: '',
  inviter_id: 0,
  registration_limit: 100,
  bonus_amount: 0,
  expires_at: undefined as Date | undefined,
  remark: '',
}

export type InviteCodeFormValues = {
  name: string
  code: string
  enabled: boolean
  group: string
  inviter_id: number
  registration_limit: number
  bonus_amount: number
  expires_at?: Date
  remark: string
}

export function getInviteCodeFormSchema(t: TFunction) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(1, t('Name is required'))
      .max(100, t('Name must be at most 100 characters')),
    code: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || /^[a-z0-9][a-z0-9_-]{2,63}$/.test(value),
        t(
          'Invitation code must be 3–64 lowercase letters, numbers, hyphens, or underscores'
        )
      ),
    enabled: z.boolean(),
    group: z.string().trim().min(1, t('Choose an existing group')),
    inviter_id: z.number().int().min(0, t('Inviter ID cannot be negative')),
    registration_limit: z
      .number()
      .int()
      .min(0, t('Registration limit cannot be negative'))
      .max(1_000_000_000, t('Registration limit is too large')),
    bonus_amount: z.number().min(0, t('Bonus cannot be negative')),
    expires_at: z.date().optional(),
    remark: z
      .string()
      .trim()
      .max(255, t('Remark must be at most 255 characters')),
  })
}

export function inviteCodeToFormValues(code: InviteCode): InviteCodeFormValues {
  return {
    name: code.name,
    code: code.code,
    enabled: code.enabled,
    group: code.group,
    inviter_id: code.inviter_id,
    registration_limit: code.registration_limit,
    bonus_amount: quotaUnitsToEditableAmount(code.bonus_quota),
    expires_at:
      code.expires_at > 0 ? new Date(code.expires_at * 1000) : undefined,
    remark: code.remark,
  }
}

export function formValuesToInviteCodePayload(
  values: InviteCodeFormValues
): InviteCodePayload {
  const { meta } = getCurrencyDisplay()
  const bonusQuota =
    meta.kind === 'tokens'
      ? Math.max(0, Math.trunc(values.bonus_amount))
      : parseQuotaFromDollars(values.bonus_amount)

  return {
    name: values.name.trim(),
    code: normalizeInviteCode(values.code) || undefined,
    enabled: values.enabled,
    group: values.group,
    inviter_id: values.inviter_id,
    registration_limit: values.registration_limit,
    bonus_quota: bonusQuota,
    expires_at: values.expires_at
      ? Math.floor(values.expires_at.getTime() / 1000)
      : 0,
    remark: values.remark.trim(),
  }
}

export function inviteCodeUrl(code: string): string {
  if (typeof window === 'undefined') {
    return `/sign-up?invite_code=${encodeURIComponent(code)}`
  }
  const url = new URL('/sign-up', window.location.origin)
  url.searchParams.set('invite_code', code)
  return url.toString()
}
