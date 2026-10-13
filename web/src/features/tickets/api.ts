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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  TicketCreateInput,
  TicketDetail,
  TicketMessageInput,
  TicketPage,
  TicketStatus,
  TicketStorageSettings,
} from './types'

export async function getTicketStorage(): Promise<TicketStorageSettings> {
  const result = await api.get('/api/admin/tickets/storage')
  return requireServerSuccess(result.data).data as TicketStorageSettings
}

export async function saveTicketStorage(
  input: Omit<TicketStorageSettings, 'credentials_configured'> & {
    access_key: string
    secret_key: string
  }
): Promise<TicketStorageSettings> {
  const result = await api.put('/api/admin/tickets/storage', input)
  return requireServerSuccess(result.data).data as TicketStorageSettings
}

export function ticketBase(staff: boolean): string {
  return staff ? '/api/admin/tickets' : '/api/tickets'
}

export async function listTickets(
  staff: boolean,
  params: Record<string, string | number>
): Promise<TicketPage> {
  const result = await api.get(ticketBase(staff), { params })
  return requireServerSuccess(result.data).data as TicketPage
}
export async function getTicket(
  staff: boolean,
  id: number,
  before = 0
): Promise<TicketDetail> {
  const result = await api.get(`${ticketBase(staff)}/${id}`, {
    params: { before },
  })
  return requireServerSuccess(result.data).data as TicketDetail
}
export async function createTicket(
  input: TicketCreateInput
): Promise<{ id: number }> {
  const result = await api.post(ticketBase(false), input)
  return requireServerSuccess(result.data).data as { id: number }
}
export async function replyTicket(
  staff: boolean,
  id: number,
  input: TicketMessageInput,
  note: boolean
): Promise<void> {
  const result = await api.post(
    `${ticketBase(staff)}/${id}/${note ? 'notes' : 'messages'}`,
    input
  )
  requireServerSuccess(result.data)
}
export async function changeTicket(
  staff: boolean,
  id: number,
  version: number,
  status?: TicketStatus,
  assignee_id?: number
): Promise<void> {
  const result = await api.patch(`${ticketBase(staff)}/${id}`, {
    version,
    status,
    assignee_id,
  })
  requireServerSuccess(result.data)
}
export async function readTicket(
  staff: boolean,
  id: number,
  version: number
): Promise<void> {
  const result = await api.post(`${ticketBase(staff)}/${id}/read`, { version })
  requireServerSuccess(result.data)
}
export async function unreadTickets(staff: boolean): Promise<number> {
  const result = await api.get(`${ticketBase(staff)}/unread`)
  return (requireServerSuccess(result.data).data as { count: number }).count
}
export async function getScreenshot(
  staff: boolean,
  id: number,
  attachment: number
): Promise<Blob> {
  const result = await api.get<Blob>(
    `${ticketBase(staff)}/${id}/attachments/${attachment}`,
    { responseType: 'blob' }
  )
  return result.data
}
export async function cleanupTickets(days: number): Promise<number> {
  const result = await api.post('/api/admin/tickets/cleanup', { days })
  return (requireServerSuccess(result.data).data as { deleted: number }).deleted
}
