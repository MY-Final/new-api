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
import { z } from 'zod'

export const ticketSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Invalid ticket request')
    .max(160, 'Invalid ticket request'),
  category: z.enum(['api', 'payment', 'account', 'suggestion', 'other'], {
    error: 'Invalid ticket request',
  }),
  content: z
    .string()
    .trim()
    .min(1, 'Invalid ticket request')
    .max(20000, 'Invalid ticket request'),
  request_id: z.string().max(128, 'Invalid ticket request'),
  order_number: z.string().max(128, 'Invalid ticket request'),
  model_name: z.string().max(128, 'Invalid ticket request'),
})
export const ticketReplySchema = ticketSchema.pick({ content: true })
export type TicketReplyValues = z.infer<typeof ticketReplySchema>
export type TicketFormValues = z.infer<typeof ticketSchema>
