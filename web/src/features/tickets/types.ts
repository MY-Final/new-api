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
export type TicketStatus =
  | 'pending'
  | 'processing'
  | 'waiting'
  | 'resolved'
  | 'closed'
export type TicketCategory =
  | 'api'
  | 'payment'
  | 'account'
  | 'suggestion'
  | 'other'
export interface Ticket {
  id: number
  user_id: number
  title: string
  category: TicketCategory
  status: TicketStatus
  assignee_id: number
  version: number
  request_id: string
  order_number: string
  model_name: string
  occurred_at: number
  created_at: number
  updated_at: number
  unread: boolean
  user_name?: string
  assignee_name?: string
  preview?: string
  preview_sender_type?: 'user' | 'admin' | 'note'
}

export interface TicketStats {
  pending: number
  processing: number
  waiting: number
  resolved: number
  closed: number
  all: number
  unread: number
}
export interface Screenshot {
  name: string
  data: string
}
export interface TicketAttachment {
  expires_at?: number
  size?: number
  id: number
  name: string
  content_type: string
}

export interface TicketStorageSettings {
  enabled: boolean
  retention_days: number
  endpoint: string
  bucket: string
  notify_email: string
  credentials_configured: boolean
}
export interface TicketMessage {
  id: number
  sender_id: number
  sender_type: 'user' | 'admin' | 'note'
  sender_name?: string
  content: string
  created_at: number
  attachments: TicketAttachment[]
}
export interface TicketEvent {
  id: number
  actor_id: number
  action: string
  from_status: TicketStatus
  to_status: TicketStatus
  assignee_id: number
  created_at: number
}
export interface TicketDetail {
  ticket: Ticket
  requester?: {
    id: number
    username: string
    email: string
  }
  messages: TicketMessage[]
  events: TicketEvent[]
  has_more: boolean
}
export interface TicketPage {
  items: Ticket[]
  total: number
  page: number
  page_size: number
}
export interface TicketMessageInput {
  content: string
  request_key: string
  screenshots: Screenshot[]
  resolve?: boolean
}
export interface TicketCreateInput extends TicketMessageInput {
  title: string
  category: TicketCategory
  request_id: string
  order_number: string
  model_name: string
  occurred_at: number
}
