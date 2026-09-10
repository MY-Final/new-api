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
import type { TFunction } from 'i18next'
import { Bell, CheckCheck, Megaphone, Pin } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RichContent } from '@/components/rich-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AnnouncementDetailModal } from '@/features/dashboard/components/overview/announcement-detail-dialog'
import { getAnnouncementKey } from '@/features/dashboard/lib/announcements'
import { getPreviewText } from '@/features/dashboard/lib'
import type { AnnouncementItem } from '@/features/dashboard/types'
import { getAnnouncementColorClass } from '@/lib/colors'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'

interface NotificationPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  unreadCount: number
  activeTab: 'notice' | 'announcements'
  onTabChange: (tab: 'notice' | 'announcements') => void
  notice: string
  announcements: AnnouncementItem[]
  unreadAnnouncementsCount: number
  isAnnouncementRead: (item: AnnouncementItem) => boolean
  onAnnouncementRead: (item: AnnouncementItem) => void
  onMarkAllAnnouncementsRead: () => void
  loading: boolean
  className?: string
}

/**
 * Get relative time string from a date
 */
function getRelativeTime(publishDate: string | Date, t: TFunction): string {
  if (!publishDate) return ''

  const now = new Date()
  const pubDate = new Date(publishDate)

  // If invalid date, return original string
  if (Number.isNaN(pubDate.getTime())) {
    return typeof publishDate === 'string' ? publishDate : ''
  }

  const diffMs = now.getTime() - pubDate.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)
  const diffWeeks = Math.floor(diffDays / 7)
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  // If future time, show specific date
  if (diffMs < 0) return formatDateTimeObject(pubDate)

  // Return relative time based on difference
  if (diffSeconds < 60) return t('Just now')
  if (diffMinutes < 60) {
    return diffMinutes === 1
      ? t('1 minute ago')
      : t('{{count}} minutes ago', { count: diffMinutes })
  }
  if (diffHours < 24) {
    return diffHours === 1
      ? t('1 hour ago')
      : t('{{count}} hours ago', { count: diffHours })
  }
  if (diffDays < 7) {
    return diffDays === 1
      ? t('1 day ago')
      : t('{{count}} days ago', { count: diffDays })
  }
  if (diffWeeks < 4) {
    return diffWeeks === 1
      ? t('1 week ago')
      : t('{{count}} weeks ago', { count: diffWeeks })
  }
  if (diffMonths < 12) {
    return diffMonths === 1
      ? t('1 month ago')
      : t('{{count}} months ago', { count: diffMonths })
  }
  if (diffYears < 2) return t('1 year ago')

  // Over 2 years, show specific date
  return formatDateTimeObject(pubDate)
}

/**
 * Announcement status dot indicator
 */
function AnnouncementDot({ type }: { type?: string }) {
  return (
    <span className='relative flex w-3 shrink-0 justify-center'>
      <span
        className={cn(
          'mt-[5px] inline-block size-2.5 shrink-0 rounded-full',
          getAnnouncementColorClass(type)
        )}
      />
    </span>
  )
}

/**
 * Empty state component
 */
function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description?: string
}) {
  return (
    <Empty className='min-h-48 border-0 p-4'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  )
}

/**
 * Notice tab content
 */
function NoticeContent({
  notice,
  loading,
  t,
}: {
  notice: string
  loading: boolean
  t: TFunction
}) {
  if (loading) {
    return (
      <EmptyState
        icon={<Bell />}
        title={t('Loading...')}
        description={t('Latest platform updates and notices')}
      />
    )
  }

  if (!notice) {
    return (
      <EmptyState icon={<Bell />} title={t('No announcements at this time')} />
    )
  }

  return (
    <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
      <RichContent breaks content={notice} />
    </ScrollArea>
  )
}

/**
 * Announcements tab content
 */
function AnnouncementsContent({
  announcements,
  isAnnouncementRead,
  onAnnouncementRead,
  loading,
  t,
}: {
  announcements: AnnouncementItem[]
  isAnnouncementRead: (item: AnnouncementItem) => boolean
  onAnnouncementRead: (item: AnnouncementItem) => void
  loading: boolean
  t: TFunction
}) {
  if (loading) {
    return (
      <EmptyState
        icon={<Megaphone />}
        title={t('Loading...')}
        description={t('Latest platform updates and notices')}
      />
    )
  }

  if (announcements.length === 0) {
    return (
      <EmptyState icon={<Megaphone />} title={t('No system announcements')} />
    )
  }

  return (
    <ScrollArea className='h-[min(52vh,28rem)] pr-3'>
      <div className='flex flex-col'>
        {announcements.map((item, idx) => {
          const announcementKey = getAnnouncementKey(item)
          const read = isAnnouncementRead(item)
          const publishDate = item.publishDate
            ? new Date(item.publishDate)
            : null
          const relativeTime = publishDate
            ? getRelativeTime(publishDate, t)
            : ''
          const absoluteTime = publishDate
            ? formatDateTimeObject(publishDate)
            : ''
          const isLast = idx === announcements.length - 1
          let railClassName = ''
          if (idx === 0) {
            railClassName = 'bottom-0 top-[22px]'
          } else if (isLast) {
            railClassName = 'top-0 h-[22px]'
          } else {
            railClassName = 'bottom-0 top-0'
          }

          return (
            <div
              key={announcementKey}
              role='button'
              tabIndex={0}
              aria-pressed={read}
              aria-label={item.content || t('System Announcements')}
              onClick={() => onAnnouncementRead(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onAnnouncementRead(item)
                }
              }}
              className='group hover:bg-muted/40 focus-visible:ring-ring relative -mx-1 flex w-full gap-3 rounded-md px-1 py-3 text-left outline-none focus-visible:ring-2'
            >
              {announcements.length > 1 && (
                <span
                  aria-hidden='true'
                  className={cn(
                    'absolute left-[10px] w-px bg-border',
                    railClassName
                  )}
                />
              )}
              <AnnouncementDot type={item.type} />
              <div className='flex min-w-0 flex-1 flex-col gap-1'>
                <div className='flex min-w-0 items-start gap-1.5'>
                  {item.pinned ? (
                    <span title={t('Pinned')} className='mt-0.5 shrink-0'>
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
                    {getPreviewText(item.content || '', 120)}
                  </p>
                </div>
                {absoluteTime ? (
                  <div className='flex items-center justify-between'>
                    <time className='text-muted-foreground/60 text-xs'>
                      {relativeTime ? `${relativeTime} • ` : null}
                      {absoluteTime}
                    </time>
                    <span className='text-muted-foreground/40 text-xs opacity-0 transition-opacity group-hover:opacity-100'>
                      {t('Click for details')}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

/**
 * Notification popover with Notice and Announcements tabs
 */
export function NotificationPopover({
  open,
  onOpenChange,
  unreadCount,
  activeTab,
  onTabChange,
  notice,
  announcements,
  unreadAnnouncementsCount,
  isAnnouncementRead,
  onAnnouncementRead,
  onMarkAllAnnouncementsRead,
  loading,
  className,
}: NotificationPopoverProps) {
  const { t } = useTranslation()
  const [selectedAnnouncement, setSelectedAnnouncement] =
    useState<AnnouncementItem | null>(null)

  const handleAnnouncementClick = (item: AnnouncementItem) => {
    onAnnouncementRead(item)
    setSelectedAnnouncement(item)
    onOpenChange(false)
  }

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          render={
            <Button
              variant='ghost'
              size='icon'
              className={cn('relative size-9', className)}
              aria-label={t('Notifications')}
            />
          }
        >
          <Bell className='size-[1.2rem]' />
          {unreadCount > 0 ? (
            <Badge
              variant='destructive'
              className='absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold tabular-nums'
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          ) : null}
        </PopoverTrigger>

        <PopoverContent
          align='end'
          sideOffset={8}
          className='w-[min(26rem,calc(100vw-1rem))] gap-3 p-3'
        >
          <PopoverHeader className='gap-1 px-1'>
            <PopoverTitle>{t('System Announcements')}</PopoverTitle>
            <p className='text-muted-foreground text-xs'>
              {t('Latest platform updates and notices')}
            </p>
          </PopoverHeader>

          <Tabs
            value={activeTab}
            onValueChange={onTabChange as (value: string) => void}
          >
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='notice' className='gap-1.5'>
                <Bell className='size-3.5' />
                {t('Notice')}
              </TabsTrigger>
              <TabsTrigger value='announcements' className='gap-1.5'>
                <Megaphone className='size-3.5' />
                {t('Timeline')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value='notice' className='mt-2'>
              <NoticeContent notice={notice} loading={loading} t={t} />
            </TabsContent>

            <TabsContent value='announcements' className='mt-2'>
              <AnnouncementsContent
                announcements={announcements}
                isAnnouncementRead={isAnnouncementRead}
                onAnnouncementRead={handleAnnouncementClick}
                loading={loading}
                t={t}
              />
            </TabsContent>
          </Tabs>

          <div className='flex items-center justify-between gap-2'>
            {activeTab === 'announcements' && unreadAnnouncementsCount > 0 ? (
              <Button
                size='sm'
                variant='ghost'
                onClick={onMarkAllAnnouncementsRead}
              >
                <CheckCheck className='size-3.5' />
                {t('Mark all as read')}
              </Button>
            ) : (
              <span />
            )}
            <Button size='sm' onClick={() => onOpenChange(false)}>
              {t('Close')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AnnouncementDetailModal
        open={selectedAnnouncement !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedAnnouncement(null)
        }}
        announcement={selectedAnnouncement}
      />
    </>
  )
}
