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
import { Megaphone, Pin } from 'lucide-react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAnnouncements } from '@/features/dashboard/hooks/use-status-data'
import { getPreviewText } from '@/features/dashboard/lib'
import { getAnnouncementKey } from '@/features/dashboard/lib/announcements'
import type { AnnouncementItem } from '@/features/dashboard/types'
import {
  getAnnouncementColorClass,
  type AnnouncementType,
} from '@/lib/colors'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notification-store'

import { PanelWrapper } from '../ui/panel-wrapper'
import { AnnouncementDetailModal } from './announcement-detail-dialog'

const AnnouncementStatusDot = memo(function AnnouncementStatusDot(props: {
  type?: string
}) {
  return (
    <span className='relative flex w-3 shrink-0 justify-center'>
      <span
        className={cn(
          'mt-[5px] inline-block size-2.5 shrink-0 rounded-full',
          getAnnouncementColorClass(props.type)
        )}
      />
    </span>
  )
})

export function AnnouncementsPanel() {
  const { t } = useTranslation()
  const { items: list, loading } = useAnnouncements()
  const markAnnouncementRead = useNotificationStore(
    (state) => state.markAnnouncementRead
  )
  const readAnnouncementKeys = useNotificationStore(
    (state) => state.readAnnouncementKeys
  )
  const [selectedAnnouncement, setSelectedAnnouncement] =
    useState<AnnouncementItem | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const statusLegend: { type: AnnouncementType; label: string }[] = [
    { type: 'default', label: t('Default') },
    { type: 'ongoing', label: t('In Progress') },
    { type: 'success', label: t('Success') },
    { type: 'warning', label: t('Warning') },
    { type: 'error', label: t('Error') },
  ]

  const handleAnnouncementClick = (item: AnnouncementItem) => {
    markAnnouncementRead(getAnnouncementKey(item))
    setSelectedAnnouncement(item)
    setIsDialogOpen(true)
  }

  return (
    <PanelWrapper
      title={
        <span className='flex items-center gap-2'>
          <IconBadge tone='warning' size='sm'>
            <Megaphone />
          </IconBadge>
          {t('Announcements')}
        </span>
      }
      description={t('Latest platform updates and notices')}
      loading={loading}
      empty={!list.length}
      emptyMessage={t('No announcements at this time')}
      height='h-72'
      contentClassName='p-0'
      headerActions={
        <div className='flex max-w-[55%] flex-wrap items-center justify-end gap-x-3 gap-y-1'>
          {statusLegend.map((status) => (
            <span
              key={status.type}
              className='text-muted-foreground flex items-center gap-1.5 text-xs'
            >
              <span
                className={cn(
                  'size-2 rounded-full',
                  getAnnouncementColorClass(status.type)
                )}
              />
              {status.label}
            </span>
          ))}
        </div>
      }
    >
      <ScrollArea className='h-72'>
        <div>
          {list.map((item: AnnouncementItem, idx: number) => {
            const key = item.id ?? `announcement-${idx}`
            const announcementKey = getAnnouncementKey(item)
            const read = readAnnouncementKeys.includes(announcementKey)
            const isLast = idx === list.length - 1
            let railClassName = ''
            if (idx === 0) {
              railClassName = 'bottom-0 top-[22px] sm:top-[24px]'
            } else if (isLast) {
              railClassName = 'top-0 h-[22px] sm:h-[24px]'
            } else {
              railClassName = 'bottom-0 top-0'
            }
            return (
              <button
                key={key}
                type='button'
                onClick={() => handleAnnouncementClick(item)}
                className='group hover:bg-muted/40 relative flex w-full gap-3 px-4 py-3 text-left transition-colors sm:px-5'
              >
                {list.length > 1 && (
                  <span
                    aria-hidden='true'
                    className={cn(
                      'absolute left-[22px] w-px bg-border sm:left-[26px]',
                      railClassName
                    )}
                  />
                )}
                <AnnouncementStatusDot type={item.type} />
                <div className='flex min-w-0 flex-1 flex-col gap-1'>
                  <div className='flex min-w-0 items-start gap-1.5'>
                    {item.pinned ? (
                      <span
                        title={t('Pinned')}
                        className='mt-0.5 shrink-0'
                      >
                        <Pin
                          className='text-warning size-3.5'
                          aria-hidden='true'
                        />
                      </span>
                    ) : null}
                    {!read ? (
                      <span className='bg-primary mt-[7px] size-1.5 shrink-0 rounded-full'>
                        <span className='sr-only'>{t('Unread')}</span>
                      </span>
                    ) : null}
                    <p
                      className={cn(
                        'line-clamp-2 text-sm leading-5',
                        !read && 'font-medium'
                      )}
                    >
                      {getPreviewText(item.content, 120)}
                    </p>
                  </div>
                  <div className='flex items-center justify-between'>
                    {item.publishDate && (
                      <time className='text-muted-foreground/60 text-xs'>
                        {formatDateTimeObject(new Date(item.publishDate))}
                      </time>
                    )}
                    <span className='text-muted-foreground/40 text-xs opacity-0 transition-opacity group-hover:opacity-100'>
                      {t('Click for details')}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>

      <AnnouncementDetailModal
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        announcement={selectedAnnouncement}
      />
    </PanelWrapper>
  )
}
