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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { getSelf } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { SubscriptionPlansCard } from './components/subscription-plans-card'
import { useTopupInfo } from './hooks'

export function SubscriptionPlansPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { topupInfo } = useTopupInfo()

  const userQuotaQuery = useQuery({
    queryKey: ['self', 'quota'],
    queryFn: async () => {
      const res = requireServerSuccess(await getSelf())
      return Number((res.data as { quota?: number } | undefined)?.quota ?? 0)
    },
    staleTime: 30_000,
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Subscription Plans')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void navigate({ to: '/wallet' })}
        >
          <Wallet className='size-4' />
          {t('Wallet')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-7xl'>
          <SubscriptionPlansCard
            topupInfo={topupInfo}
            userQuota={userQuotaQuery.data}
            onPurchaseSuccess={async () => {
              await queryClient.invalidateQueries({
                queryKey: ['self', 'quota'],
              })
            }}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
