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
import { ExternalLink, PanelsTopLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { buttonVariants } from '@/components/ui/button'

import { useCustomPages } from './hooks/use-custom-pages'

/**
 * Renders one administrator-configured page inside the console.
 *
 * The frame keeps `sandbox` (with same-origin so the embedded app can use its
 * own cookies) and never allows top-level navigation, so a configured page
 * cannot navigate the console away. Pages that refuse framing show an empty
 * frame, which is why "open in a new tab" stays visible next to the title.
 */
export function CustomPageEmbed(props: { slug: string }) {
  const { t } = useTranslation()
  const { links, isLoading, isError } = useCustomPages()
  const page = links.find((link) => link.slug === props.slug)

  if (isLoading) {
    return <LoadingState className='min-h-[300px]' />
  }

  if (!page) {
    return (
      <EmptyState
        icon={PanelsTopLeft}
        title={isError ? t('Failed to load custom pages') : t('Page not found')}
        description={t(
          'This page is not configured, was renamed, or is limited to administrators.'
        )}
      />
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2'>
        <div className='min-w-0'>
          <h2 className='truncate text-sm font-semibold'>{t(page.name)}</h2>
          <p className='text-muted-foreground truncate text-xs'>{page.url}</p>
        </div>
        <a
          href={page.url}
          target='_blank'
          rel='noopener noreferrer'
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ExternalLink className='size-3.5' aria-hidden='true' />
          {t('Open in new tab')}
        </a>
      </div>
      {/* eslint-disable react/iframe-missing-sandbox -- the embedded app needs its own origin for cookies/sessionStorage; top-level navigation stays blocked */}
      <iframe
        src={page.url}
        title={t(page.name)}
        sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'
        referrerPolicy='no-referrer'
        className='min-h-0 w-full flex-1 border-0'
      />
      {/* eslint-enable react/iframe-missing-sandbox */}
    </div>
  )
}
