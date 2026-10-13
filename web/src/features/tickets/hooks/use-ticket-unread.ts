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
import { useQuery } from '@tanstack/react-query'

import { hasPermission } from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import { unreadTickets } from '../api'

export function useTicketUnread() {
  const user = useAuthStore((state) => state.auth.user)
  const canRead = hasPermission(user, 'ticket', 'read')
  const personal = useQuery({
    queryKey: ['tickets', 'unread', false, user?.id],
    queryFn: () => unreadTickets(false),
    enabled: Boolean(user),
    refetchInterval: 30000,
    staleTime: 15000,
  })
  const staff = useQuery({
    queryKey: ['tickets', 'unread', true, user?.id],
    queryFn: () => unreadTickets(true),
    enabled: canRead,
    refetchInterval: 30000,
    staleTime: 15000,
  })
  return { personal: personal.data ?? 0, staff: staff.data ?? 0, canRead }
}
