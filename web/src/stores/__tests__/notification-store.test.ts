/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { beforeEach, describe, expect, test } from 'vitest'

import { useNotificationStore } from '../notification-store'

beforeEach(() => {
  localStorage.clear()
  useNotificationStore.setState({
    lastReadNotice: '',
    readAnnouncementKeys: [],
    closedUntilDate: null,
  })
})

describe('announcement read state', () => {
  test('marks only the requested announcement as read', () => {
    useNotificationStore.getState().markAnnouncementRead('id:1')

    expect(useNotificationStore.getState().isAnnouncementRead('id:1')).toBe(
      true
    )
    expect(useNotificationStore.getState().isAnnouncementRead('id:2')).toBe(
      false
    )
  })

  test('marks all supplied announcements as read without duplicating keys', () => {
    useNotificationStore.getState().markAnnouncementsRead(['id:1', 'id:2'])
    useNotificationStore.getState().markAnnouncementsRead(['id:2', 'id:3'])

    expect(useNotificationStore.getState().readAnnouncementKeys).toEqual([
      'id:1',
      'id:2',
      'id:3',
    ])
  })

  test('persists and rehydrates announcement read state from localStorage', async () => {
    useNotificationStore.getState().markAnnouncementRead('id:7')
    const stored = localStorage.getItem('notification-storage')

    expect(stored).toContain('id:7')

    useNotificationStore.setState({ readAnnouncementKeys: [] })
    localStorage.setItem(
      'notification-storage',
      JSON.stringify({
        state: {
          lastReadNotice: '',
          readAnnouncementKeys: ['id:7'],
          closedUntilDate: null,
        },
        version: 0,
      })
    )
    await useNotificationStore.persist.rehydrate()

    expect(useNotificationStore.getState().isAnnouncementRead('id:7')).toBe(
      true
    )
  })
})
