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

import { api } from '@/lib/api'
import { normalizeCustomPages, type CustomPage } from '@/lib/custom-pages'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}

/**
 * Embedded pages the current user may open. The backend drops admin-only pages
 * for other roles, so the sidebar never shows a link it cannot resolve.
 */
export async function getCustomPages(): Promise<CustomPage[]> {
  const response = await api.get<ApiResponse<CustomPage[]>>('/api/custom-pages')
  const payload = requireServerSuccess(response.data)
  if (!payload.data) {
    throw createServerError(payload, i18next.t('Failed to load custom pages'))
  }
  return normalizeCustomPages(payload.data)
}
