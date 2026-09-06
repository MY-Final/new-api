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
import { describe, expect, test } from 'vitest'

import { getAnnouncementKey, sortAnnouncements } from '../announcements'

describe('announcement ordering', () => {
  test('puts pinned announcements first and sorts each group by publish date', () => {
    const announcements = [
      { id: 1, content: 'old regular', publishDate: '2026-01-01' },
      {
        id: 2,
        content: 'old pinned',
        publishDate: '2026-01-01',
        pinned: true,
      },
      {
        id: 3,
        content: 'new regular',
        publishDate: '2026-02-01',
      },
      {
        id: 4,
        content: 'new pinned',
        publishDate: '2026-02-01',
        pinned: true,
      },
    ]

    expect(sortAnnouncements(announcements).map((item) => item.id)).toEqual([
      4, 2, 3, 1,
    ])
  })

  test('keeps an announcement key stable when its pinned state changes', () => {
    const announcement = {
      id: 12,
      content: 'Service update',
      publishDate: '2026-02-01',
      pinned: false,
    }

    expect(getAnnouncementKey(announcement)).toBe(
      getAnnouncementKey({ ...announcement, pinned: true })
    )
  })
})
