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
import { ExternalLink, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { buttonVariants } from '@/components/ui/button'
import { TitledCard } from '@/components/ui/titled-card'
import type { CustomPageLink } from '@/lib/custom-pages'
import { cn } from '@/lib/utils'

interface WalletShopPanelProps {
  page: CustomPageLink
  className?: string
}

/**
 * Embeds the administrator's highlighted custom page (the shop) beside the
 * wallet so a card bought here can be redeemed on the same page.
 *
 * The frame keeps the same sandbox as the full-page custom page embed: the
 * shop needs its own cookies to keep a cart, while top-level navigation stays
 * blocked and the console can never be replaced by the embedded site.
 */
export function WalletShopPanel(props: WalletShopPanelProps) {
  const { t } = useTranslation()

  return (
    <TitledCard
      title={t(props.page.name)}
      description={t('Buy a card in the shop, then redeem it on this page.')}
      icon={<Store className='h-4 w-4' />}
      iconTone='info'
      disableHoverEffect
      className={cn(
        'h-[70dvh] min-h-[420px] xl:h-[calc(100dvh-7rem)]',
        props.className
      )}
      contentClassName='flex min-h-0 flex-1 flex-col p-0'
      action={
        <a
          href={props.page.url}
          target='_blank'
          rel='noopener noreferrer'
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          <ExternalLink className='size-3.5' aria-hidden='true' />
          {t('Open in new tab')}
        </a>
      }
    >
      {/* eslint-disable react/iframe-missing-sandbox -- the shop keeps its own cart cookie; top-level navigation stays blocked */}
      <iframe
        src={props.page.url}
        title={t(props.page.name)}
        sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'
        referrerPolicy='no-referrer'
        className='min-h-0 w-full flex-1 border-0'
      />
      {/* eslint-enable react/iframe-missing-sandbox */}
    </TitledCard>
  )
}
