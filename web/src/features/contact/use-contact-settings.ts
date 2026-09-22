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
import { useTranslation } from 'react-i18next'

import type { ContactStatus } from '@/features/auth/types'
import { useStatus } from '@/hooks/use-status'

export interface ContactSettings {
  title: string
  description: string
  qqGroupNumber: string
  qqGroupURL: string
  qrcodeSrc: string
  /** Whether any contact detail is configured; nothing renders until it is. */
  configured: boolean
}

/** Contact details only exist once an administrator configures them. */
export function isContactConfigured(contact?: ContactStatus): boolean {
  return Boolean(
    contact?.qrcode_version?.trim() ||
    contact?.qq_group_number?.trim() ||
    contact?.qq_group_url?.trim()
  )
}

/**
 * Resolve the public contact configuration from `/api/status`. Empty fields
 * stay empty: the page and dialog show an empty state instead of baked-in
 * defaults, so a fresh deployment carries no project-specific contact data.
 */
export function useContactSettings(): ContactSettings {
  const { t } = useTranslation()
  const { status } = useStatus()
  const contact = status?.contact
  const qrcodeVersion = contact?.qrcode_version?.trim()

  return {
    title: contact?.title?.trim() || t('Contact Us'),
    description:
      contact?.description?.trim() ||
      t('Questions, announcements and communication are welcome.'),
    qqGroupNumber: contact?.qq_group_number?.trim() ?? '',
    qqGroupURL: contact?.qq_group_url?.trim() ?? '',
    qrcodeSrc: qrcodeVersion
      ? `/api/contact/qrcode?v=${encodeURIComponent(qrcodeVersion)}`
      : '',
    configured: isContactConfigured(contact),
  }
}
