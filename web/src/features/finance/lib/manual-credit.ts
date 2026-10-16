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
import { z } from 'zod'

export const paymentChannels = [
  {
    value: 'wechat',
    label: 'WeChat Pay',
    variant: 'success',
    className: 'bg-success/10',
  },
  {
    value: 'alipay',
    label: 'Alipay',
    variant: 'blue',
    className: 'bg-chart-1/10',
  },
  {
    value: 'bank_transfer',
    label: 'Bank transfer',
    variant: 'purple',
    className: 'bg-chart-4/10',
  },
  { value: 'usdt', label: 'USDT', variant: 'cyan', className: 'bg-chart-2/10' },
  { value: 'other', label: 'Other', variant: 'neutral', className: 'bg-muted' },
] as const

export const creditSchema = z.object({
  paid: z
    .string()
    .refine(
      (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
      'Invalid amount'
    ),
  bonus: z
    .string()
    .refine(
      (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
      'Invalid amount'
    ),
  paymentChannel: z
    .string()
    .refine(
      (value) => paymentChannels.some((channel) => channel.value === value),
      'Select a valid payment channel'
    ),
  reference: z.string().trim().max(128, 'Invalid parameters'),
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is required')
    .max(255, 'Reason must contain 1 to 255 characters'),
})

export type CreditForm = z.infer<typeof creditSchema>
