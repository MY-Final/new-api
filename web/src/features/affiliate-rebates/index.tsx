import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { getAffiliateRebates } from '@/features/wallet/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { AffiliateRebatesTable } from './components/affiliate-rebates-table'
import type { AffiliateRebateFilters } from './types'

export function AffiliateRebates() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<AffiliateRebateFilters>({
    page: 1,
    pageSize: 20,
  })
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['affiliate-rebates', filters],
    queryFn: async () => {
      const response = await getAffiliateRebates(
        filters.page,
        filters.pageSize,
        filters.sourceType,
        {
          status: filters.status,
          startTime: filters.startTime,
          endTime: filters.endTime,
        }
      )
      requireServerSuccess(response)
      return {
        total: response.data?.total || 0,
        items: response.data?.items || [],
      }
    },
    placeholderData: (previousData) => previousData,
  })
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Affiliate Rebates')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <AffiliateRebatesTable
          filters={filters}
          setFilters={setFilters}
          items={data?.items || []}
          total={data?.total || 0}
          isLoading={isLoading}
          isFetching={isFetching}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
