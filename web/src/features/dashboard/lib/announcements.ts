/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import type { AnnouncementItem } from '../types'

type AnnouncementWithLegacyFields = AnnouncementItem & {
  title?: string
  link?: string
}

function hashString(input: string): string {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return hash.toString(36)
}

export function getAnnouncementKey(item: AnnouncementItem): string {
  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const legacyItem = item as AnnouncementWithLegacyFields
  const fingerprint = JSON.stringify({
    publishDate: legacyItem.publishDate || '',
    content: (legacyItem.content || '').trim(),
    extra: (legacyItem.extra || '').trim(),
    type: legacyItem.type || '',
    title: (legacyItem.title || '').trim(),
    link: (legacyItem.link || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

export function sortAnnouncements<T extends AnnouncementItem>(
  announcements: readonly T[]
): T[] {
  return announcements
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const pinnedDifference =
        Number(Boolean(right.item.pinned)) - Number(Boolean(left.item.pinned))
      if (pinnedDifference !== 0) return pinnedDifference

      const rightTime = Date.parse(right.item.publishDate ?? '')
      const leftTime = Date.parse(left.item.publishDate ?? '')
      const rightTimestamp = Number.isNaN(rightTime) ? 0 : rightTime
      const leftTimestamp = Number.isNaN(leftTime) ? 0 : leftTime
      return rightTimestamp - leftTimestamp || left.index - right.index
    })
    .map(({ item }) => item)
}
