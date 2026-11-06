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
import axios from 'axios'

import { api } from '@/lib/api'

import type {
  ApiResponse,
  InviteCode,
  InviteCodeClaim,
  InviteCodeListParams,
  InviteCodePayload,
  PageData,
  PublicInviteCode,
} from './types'

export async function getInviteCodes(
  params: InviteCodeListParams
): Promise<ApiResponse<PageData<InviteCode>>> {
  const response = await api.get('/api/invite_codes', { params })
  return response.data
}

export async function createInviteCode(
  payload: InviteCodePayload
): Promise<ApiResponse<InviteCode>> {
  const response = await api.post('/api/invite_codes', payload)
  return response.data
}

export async function updateInviteCode(
  id: number,
  payload: InviteCodePayload
): Promise<ApiResponse<InviteCode>> {
  const response = await api.put(`/api/invite_codes/${id}`, payload)
  return response.data
}

export async function getInviteCodeClaims(
  id: number,
  page: number,
  pageSize: number
): Promise<ApiResponse<PageData<InviteCodeClaim>>> {
  const response = await api.get(`/api/invite_codes/${id}/claims`, {
    params: { p: page, page_size: pageSize },
  })
  return response.data
}

export async function getPublicInviteCode(
  code: string
): Promise<ApiResponse<PublicInviteCode>> {
  try {
    const response = await api.get(
      `/api/invite_codes/public/${encodeURIComponent(code)}`,
      {
        skipBusinessError: true,
        skipErrorHandler: true,
      }
    )
    return response.data
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return { success: false, message: '' }
    }
    throw error
  }
}
