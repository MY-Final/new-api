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
import * as z from 'zod'

import {
  EMAIL_PURPOSES,
  type EmailPurpose,
  type EmailRoute,
} from './email-purposes'

const emailRouteSchema = z.enum(['', 'smtp', 'resend'])

// The shape is derived from the purpose catalog so a new purpose cannot be
// routed in one place and rejected in another.
const emailRoutingShape = Object.fromEntries(
  EMAIL_PURPOSES.map((purpose) => [purpose.key, emailRouteSchema])
) as Record<EmailPurpose, typeof emailRouteSchema>

const emailQuotaSchema = (message: string) =>
  z.string().refine((value) => {
    const trimmed = value.trim()
    if (!trimmed) return true
    return /^\d+$/.test(trimmed) && Number(trimmed) <= 1000000
  }, message)

export const createEmailSchema = (t: (key: string) => string) =>
  z
    .object({
      EmailProvider: z.enum(['smtp', 'resend']),
      ResendApiKey: z.string(),
      ResendKeyConfigured: z.boolean(),
      ResendFrom: z.string(),
      ResendSenderName: z.string(),
      // Compared with the monthly sending volume on the statistics section.
      ResendMonthlyQuota: emailQuotaSchema(
        t('Enter a whole number between 0 and 1000000')
      ),
      // Resend limits a day of the free plan to 100 messages.
      ResendDailyQuota: emailQuotaSchema(
        t('Enter a whole number between 0 and 1000000')
      ),
      EmailPurposeRouting: z.object(emailRoutingShape),
      SMTPServer: z.string(),
      SMTPPort: z.string(),
      SMTPAccount: z.string(),
      SMTPFrom: z.string(),
      SMTPToken: z.string(),
      SMTPSSLEnabled: z.boolean(),
      SMTPStartTLSEnabled: z.boolean(),
      SMTPInsecureSkipVerify: z.boolean(),
      SMTPForceAuthLogin: z.boolean(),
      QuotaRemindEnabled: z.boolean(),
      // Entered as a display amount; stored in quota units.
      QuotaRemindThreshold: z.string().refine((value) => {
        const trimmed = value.trim()
        if (!trimmed) return true
        return Number.isFinite(Number(trimmed)) && Number(trimmed) >= 0
      }, t('Must be greater than or equal to 0')),
    })
    .superRefine((values, context) => {
      const routes = Object.values(values.EmailPurposeRouting)
      const usesResend =
        values.EmailProvider === 'resend' || routes.includes('resend')
      const usesSMTP =
        values.EmailProvider === 'smtp' || routes.includes('smtp')

      if (usesResend) {
        if (!values.ResendKeyConfigured && !values.ResendApiKey.trim()) {
          context.addIssue({
            code: 'custom',
            path: ['ResendApiKey'],
            message: t('Configure a Resend API key before enabling Resend'),
          })
        }
        const from = values.ResendFrom.trim()
        if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)) {
          context.addIssue({
            code: 'custom',
            path: ['ResendFrom'],
            message: t('Enter a valid sender email address'),
          })
        }
        const name = values.ResendSenderName
        if (/[\r\n]/.test(name) || name.includes('\0')) {
          context.addIssue({
            code: 'custom',
            path: ['ResendSenderName'],
            message: t(
              'Sender name must not contain line breaks or null characters'
            ),
          })
        }
      }
      if (!usesSMTP) return
      const port = values.SMTPPort.trim()
      if (
        port &&
        (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['SMTPPort'],
          message: t('Port must be a positive integer'),
        })
      }
      const from = values.SMTPFrom.trim()
      if (from && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
        context.addIssue({
          code: 'custom',
          path: ['SMTPFrom'],
          message: t('Enter a valid email or leave blank'),
        })
      }
    })

export type EmailFormValues = z.infer<ReturnType<typeof createEmailSchema>>

export type EmailPurposeRouting = Record<EmailPurpose, EmailRoute>

// Keep the existing ResendFrom option/API contract while editing its two parts.
export function parseResendSender(value: string) {
  const named = value.trim().match(/^(.*?)\s*<([^<>]+)>$/)
  if (!named) return { ResendFrom: value.trim(), ResendSenderName: '' }
  let name = named[1].trim()
  if (name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).replaceAll(/\\(.)/g, '$1')
  }
  return { ResendFrom: named[2].trim(), ResendSenderName: name }
}

function parseStoredRouting(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // A malformed option falls back to "every purpose follows the selector".
  }
  return {}
}

export function parseEmailPurposeRouting(value: string): EmailPurposeRouting {
  const stored = parseStoredRouting(value)
  const routes = {} as EmailPurposeRouting
  for (const purpose of EMAIL_PURPOSES) {
    const route = stored[purpose.key]
    routes[purpose.key] = route === 'smtp' || route === 'resend' ? route : ''
  }
  return routes
}

// Serializing only the overrides keeps the stored option small and gives the
// save handler one stable string to compare against the initial values.
export function serializeEmailPurposeRouting(
  routes: EmailPurposeRouting | undefined
): string {
  const stored: Record<string, EmailRoute> = {}
  for (const purpose of EMAIL_PURPOSES) {
    const route = routes?.[purpose.key]
    if (route === 'smtp' || route === 'resend') stored[purpose.key] = route
  }
  return JSON.stringify(stored)
}
