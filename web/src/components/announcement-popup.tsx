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
import { Megaphone } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { useAnnouncements } from '@/features/dashboard/hooks/use-status-data'
import { getAnnouncementKey } from '@/features/dashboard/lib/announcements'
import type { AnnouncementItem } from '@/features/dashboard/types'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notification-store'

const TYPE_LABEL_KEYS: Record<string, string> = {
  default: 'Default',
  ongoing: 'In Progress',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
}

const TYPE_CHIP_CLASS: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  ongoing: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
}

// Auto-popup shown once per page load when an announcement the user has not
// seen yet exists. Dismissing marks that announcement read so it stays closed
// until a newer announcement is published.
export function AnnouncementPopup() {
  const { t } = useTranslation()
  const { items, loading } = useAnnouncements()
  const readKeys = useNotificationStore(
    (state) => state.readAnnouncementKeys
  )
  const markAnnouncementRead = useNotificationStore(
    (state) => state.markAnnouncementRead
  )
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<AnnouncementItem | null>(null)

  // Newest announcement by publish date. Pinned ordering is ignored on
  // purpose so a pinned older announcement cannot mask a fresh one. Only this
  // newest announcement may auto-popup: once it is read, older unread items
  // stay in the panel and the notification bell instead of popping up one by
  // one on every page load.
  const latest = useMemo(() => {
    if (loading || items.length === 0) return undefined
    return items.reduce((left, right) => {
      const leftTime = Date.parse(left.publishDate ?? '') || 0
      const rightTime = Date.parse(right.publishDate ?? '') || 0
      return rightTime > leftTime ? right : left
    })
  }, [items, loading])

  useEffect(() => {
    if (loading || active || !latest) return
    if (readKeys.includes(getAnnouncementKey(latest))) return
    setActive(latest)
    setOpen(true)
  }, [loading, active, latest, readKeys])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen && active) {
      markAnnouncementRead(getAnnouncementKey(active))
      setActive(null)
    }
  }

  const type = active?.type ?? 'default'

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      contentClassName='sm:max-w-lg'
      headerClassName='from-info/10 rounded-xl bg-gradient-to-r to-transparent p-3'
      title={
        <span className='flex items-center gap-2.5'>
          <IconBadge tone='info' size='title'>
            <Megaphone />
          </IconBadge>
          {t('System Announcements')}
        </span>
      }
      description={t('Latest platform updates and notices')}
      footer={
        <Button size='sm' onClick={() => handleOpenChange(false)}>
          {t('Got it')}
        </Button>
      }
    >
      {active ? (
        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2 text-xs'>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 font-medium',
                TYPE_CHIP_CLASS[type] ?? TYPE_CHIP_CLASS.default
              )}
            >
              {t(TYPE_LABEL_KEYS[type] ?? 'Default')}
            </span>
            {active.publishDate && (
              <span className='text-muted-foreground'>
                {t('Published:')}{' '}
                {formatDateTimeObject(new Date(active.publishDate))}
              </span>
            )}
          </div>
          {active.content && (
            <div className='bg-muted/20 rounded-xl border p-4'>
              <RichContent breaks content={active.content} />
            </div>
          )}
          {active.extra && (
            <RichContent
              breaks
              content={active.extra}
              className='text-muted-foreground text-sm'
            />
          )}
        </div>
      ) : null}
    </Dialog>
  )
}
