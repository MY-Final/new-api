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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { STATUS_QUERY_KEY } from '@/lib/status-query'

const NOTIFICATION_STREAM_URL = '/api/notifications/stream'
const NOTICE_QUERY_KEY = ['notice'] as const

/**
 * Subscribe to console change events (announcements, notice) over SSE.
 *
 * The server sends a `ready` event after every (re)connect, so treating it as
 * a full resync covers the window between page load and stream open and
 * recovers any update missed while the connection was down. EventSource
 * reconnects by itself; this path never polls.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource(NOTIFICATION_STREAM_URL)
    const refreshStatus = () =>
      queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    const refreshNotice = () =>
      queryClient.invalidateQueries({ queryKey: NOTICE_QUERY_KEY })
    const resync = () => {
      refreshStatus()
      refreshNotice()
    }

    source.addEventListener('ready', resync)
    source.addEventListener('announcements', refreshStatus)
    source.addEventListener('notice', refreshNotice)

    return () => source.close()
  }, [queryClient])
}
