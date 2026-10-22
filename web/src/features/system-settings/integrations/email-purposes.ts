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
// Send purposes are the backend bucket names. They drive both the per-purpose
// routing table and the statistics labels, so a purpose can never exist in one
// place and be missing from the other.
export const EMAIL_PURPOSES = [
  { key: 'verify', labelKey: 'Email verification' },
  { key: 'reset', labelKey: 'Password reset' },
  { key: 'binding', labelKey: 'Email change' },
  { key: 'security', labelKey: 'Account security' },
  { key: 'quota', labelKey: 'Balance reminder' },
  { key: 'usage', labelKey: 'Usage report' },
  { key: 'ticket', labelKey: 'Ticket notification' },
  { key: 'notification', labelKey: 'Notification' },
] as const

export type EmailPurpose = (typeof EMAIL_PURPOSES)[number]['key']

export type EmailRoute = '' | 'smtp' | 'resend'

const EMAIL_PURPOSE_LABELS: Record<string, string> = {
  ...Object.fromEntries(
    EMAIL_PURPOSES.map((purpose) => [purpose.key, purpose.labelKey])
  ),
  // The fallback bucket only appears in statistics for unrecognized purposes.
  other: 'Other',
}

export function emailPurposeLabel(purpose: string): string {
  return EMAIL_PURPOSE_LABELS[purpose] ?? purpose
}
