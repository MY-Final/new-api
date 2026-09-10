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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { AnnouncementItem } from '@/features/dashboard/types'

import { NotificationPopover } from '../notification-popover'

const announcements: AnnouncementItem[] = [
  {
    id: 1,
    content: 'First announcement',
    publishDate: '2026-02-01T00:00:00Z',
  },
  {
    id: 2,
    content: 'Second announcement',
    publishDate: '2026-01-01T00:00:00Z',
  },
]

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  vi.restoreAllMocks()
})

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

function renderPopover() {
  const onAnnouncementRead = vi.fn()
  const onMarkAllAnnouncementsRead = vi.fn()
  const onOpenChange = vi.fn()

  render(
    <NotificationPopover
      open
      onOpenChange={onOpenChange}
      unreadCount={2}
      activeTab='announcements'
      onTabChange={vi.fn()}
      notice=''
      announcements={announcements}
      unreadAnnouncementsCount={2}
      isAnnouncementRead={() => false}
      onAnnouncementRead={onAnnouncementRead}
      onMarkAllAnnouncementsRead={onMarkAllAnnouncementsRead}
      loading={false}
    />
  )

  return { onAnnouncementRead, onMarkAllAnnouncementsRead, onOpenChange }
}

describe('NotificationPopover announcement read actions', () => {
  test('marks only the clicked announcement as read', async () => {
    const user = userEvent.setup()
    const { onAnnouncementRead, onOpenChange } = renderPopover()

    await user.click(screen.getByRole('button', { name: 'First announcement' }))

    expect(onAnnouncementRead).toHaveBeenCalledTimes(1)
    expect(onAnnouncementRead).toHaveBeenCalledWith(announcements[0])
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('dialog')).toHaveTextContent('First announcement')
  })

  test('offers a bulk action for the unread announcements', async () => {
    const user = userEvent.setup()
    const { onMarkAllAnnouncementsRead } = renderPopover()

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

    expect(onMarkAllAnnouncementsRead).toHaveBeenCalledTimes(1)
  })
})
