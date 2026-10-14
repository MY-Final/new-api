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
import { isAxiosError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { getScreenshot } from '../api'
import type { TicketAttachment } from '../types'

export function TicketScreenshot(props: {
  ticketId: number
  staff: boolean
  attachment: TicketAttachment
}) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const target = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === 'undefined'
  )
  const [now, setNow] = useState(Date.now())
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const expiresAt = props.attachment.expires_at
  const expired = expiresAt !== undefined && expiresAt * 1000 <= now
  const query = useQuery({
    queryKey: [
      'tickets',
      'screenshot',
      props.staff,
      userId,
      props.ticketId,
      props.attachment.id,
    ],
    queryFn: () =>
      getScreenshot(props.staff, props.ticketId, props.attachment.id),
    enabled: visible && !expired,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
  })
  const unavailable =
    expired ||
    (isAxiosError(query.error) && query.error.response?.status === 410)
  const src =
    !unavailable && image && image.blob === query.data ? image.url : null

  useEffect(() => {
    if (
      visible ||
      !target.current ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(target.current)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (expiresAt === undefined || expired) {
      return
    }
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(expiresAt * 1000 - Date.now(), 2147483647)
    )
    return () => clearTimeout(timer)
  }, [expiresAt, expired, now])

  useEffect(() => {
    if (!query.data || unavailable) return
    const url = URL.createObjectURL(query.data)
    setImage({ blob: query.data, url })
    return () => URL.revokeObjectURL(url)
  }, [query.data, unavailable])

  if (unavailable) {
    return (
      <Button variant='outline' size='sm' disabled className='max-w-full'>
        <span className='truncate'>
          {props.attachment.name} · {t('Image expired')}
        </span>
      </Button>
    )
  }

  const failed = query.isError || imageFailed
  return (
    <>
      <Button
        ref={target}
        variant='outline'
        className='h-auto w-40 max-w-full flex-col gap-0 overflow-hidden p-0'
        aria-label={
          failed
            ? `${props.attachment.name} · ${t('Retry')}`
            : props.attachment.name
        }
        disabled={query.isFetching || (!failed && !src)}
        onClick={() => {
          if (failed) {
            setImageFailed(false)
            void query.refetch()
          } else {
            setPreviewOpen(true)
          }
        }}
      >
        <span className='bg-muted/30 flex h-28 w-full items-center justify-center overflow-hidden'>
          {src && !failed && (
            <img
              src={src}
              alt={props.attachment.name}
              className='size-full object-contain'
              loading='lazy'
              onError={() => setImageFailed(true)}
            />
          )}
          {failed && (
            <span className='text-muted-foreground px-2 text-xs whitespace-normal'>
              {t('Image not available')} · {t('Retry')}
            </span>
          )}
          {!src && !failed && (
            <LoadingState inline size='sm' message={t('Loading...')} />
          )}
        </span>
        <span
          className='w-full truncate px-2 py-1.5 text-xs'
          title={props.attachment.name}
        >
          {props.attachment.name}
        </span>
      </Button>
      <ImagePreviewDialog
        src={previewOpen && !imageFailed ? src : null}
        alt={props.attachment.name}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  )
}
