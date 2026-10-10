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
import { useStatus } from '@/hooks/use-status'
import { resolveSetupDownloadUrl } from '@/lib/kuncode-setup'
import { parseHeaderNavModulesFromStatus } from '@/lib/nav-modules'

export function useSetupDownload(): boolean {
  const { status } = useStatus()
  return parseHeaderNavModulesFromStatus(status).setupDownload
}

/** Download target for the setup entry, honouring the administrator override. */
export function useSetupDownloadUrl(): string {
  const { status } = useStatus()
  return resolveSetupDownloadUrl(
    parseHeaderNavModulesFromStatus(status).setupDownloadUrl
  )
}
