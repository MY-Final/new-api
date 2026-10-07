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

import { useApiInfo } from '@/features/dashboard/hooks/use-status-data'
import { useStatus } from '@/hooks/use-status'

import { getAPIBaseURLs } from '../lib/api-addresses'

export type ApiAddress = {
  url: string
  route?: string
  description?: string
}

/**
 * Resolve the API addresses shown across the API Keys feature. The
 * administrator-configured relay endpoints (`ApiBaseURLs`) take precedence so
 * they match the API 节点 row on the keys page; dashboard API shortcuts are a
 * legacy fallback, then the server address/current origin as a final fallback.
 */
export function useApiAddresses(): {
  addresses: ApiAddress[]
  loading: boolean
} {
  const { t } = useTranslation()
  const { status, loading } = useStatus()
  const { items } = useApiInfo()
  const serverAddress =
    (typeof status?.server_address === 'string' &&
      status.server_address.trim()) ||
    ''
  const configuredURLs = getAPIBaseURLs(status?.api_base_urls)

  let addresses: ApiAddress[]
  if (configuredURLs.length) {
    addresses = configuredURLs.map((url) => ({ url }))
  } else if (items.length) {
    addresses = items.map((item) => ({
      url: item.url,
      route: item.route,
      description: item.description,
    }))
  } else {
    addresses = [
      {
        url: serverAddress || window.location.origin,
        route: serverAddress ? t('Default API address') : t('Current domain'),
      },
    ]
  }

  return { addresses, loading }
}
