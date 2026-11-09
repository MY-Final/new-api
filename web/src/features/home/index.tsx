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
import { PublicLayout } from '@/components/layout'
import { useStatus } from '@/hooks/use-status'

import { KunCodeHomePage } from './components'
import { useFreeGroupUsage } from './hooks'
import { resolveApiBaseUrl } from './lib/api-base-url'

export function Home() {
  const { status } = useStatus()
  const freeGroupUsage = useFreeGroupUsage()
  const freeGroupUsageState = {
    usage: freeGroupUsage.data,
    isLoading: freeGroupUsage.isLoading,
    isError: freeGroupUsage.isError,
  }
  const currentOrigin =
    typeof window === 'undefined' ? '' : window.location.origin
  const apiBaseUrl = resolveApiBaseUrl(status?.server_address, currentOrigin)

  return (
    <PublicLayout showMainContainer={false}>
      <KunCodeHomePage
        apiBaseUrl={apiBaseUrl}
        freeGroupUsage={freeGroupUsageState}
      />
    </PublicLayout>
  )
}
