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
import type { ApiResponse } from '@/features/profile/types'
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

export interface RequestErrorLog {
  id: number
  request_id: string
  user_id: number
  username: string
  token_id: number
  token_name: string
  model_name: string
  channel_id: number
  group: string
  ip: string
  status_code: number
  error_code: string
  error_type: string
  error_message: string
  request_path: string
  is_stream: boolean
  use_time: number
  body?: string
  body_bytes: number
  body_truncated: boolean
  created_at: number
}

export interface RequestErrorLogFilters {
  request_id?: string
  username?: string
  model_name?: string
  channel_id?: number
  status_code?: number
  keyword?: string
  p: number
  page_size: number
}

export interface RequestErrorLogPage {
  items: RequestErrorLog[]
  total: number
}

export async function getRequestErrorLogs(
  params: RequestErrorLogFilters
): Promise<RequestErrorLogPage> {
  const response = await api.get<ApiResponse<RequestErrorLogPage>>(
    '/api/log/error',
    { params }
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, 'Failed to load error requests')
  }
  return response.data.data
}

export async function getRequestErrorLog(id: number): Promise<RequestErrorLog> {
  const response = await api.get<ApiResponse<RequestErrorLog>>(
    `/api/log/error/${id}`
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, 'Failed to load error request')
  }
  return response.data.data
}

export async function deleteRequestErrorLog(id: number): Promise<void> {
  const response = await api.delete<ApiResponse<null>>(`/api/log/error/${id}`)
  if (!response.data.success) {
    throw createServerError(response.data, 'Failed to delete error request')
  }
}

export async function batchDeleteRequestErrorLogs(
  ids: number[]
): Promise<number> {
  const response = await api.post<ApiResponse<{ deleted: number }>>(
    '/api/log/error/batch-delete',
    { ids }
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, 'Failed to delete error requests')
  }
  return response.data.data.deleted
}

export async function clearRequestErrorLogs(
  params: RequestErrorLogFilters,
  confirmAll: boolean
): Promise<number> {
  const response = await api.post<ApiResponse<{ deleted: number }>>(
    '/api/log/error/clear',
    null,
    { params: { ...params, confirm: confirmAll ? 'true' : undefined } }
  )
  if (!response.data.success || !response.data.data) {
    throw createServerError(response.data, 'Failed to clear error requests')
  }
  return response.data.data.deleted
}
