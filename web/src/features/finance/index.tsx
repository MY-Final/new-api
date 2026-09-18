import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useDebounce } from '@/hooks/use-debounce'

import {
  getFinanceRebates,
  getFinanceRedemptions,
  getFinanceTopups,
  getFinancialOperations,
} from './api'
import { FinanceActionDialog } from './components/finance-action-dialog'
import { FinanceTable } from './components/finance-table'
import { asSection, sectionNames } from './lib/labels'
import type {
  FinanceAction,
  FinanceFilters,
  FinanceRecord,
  FinanceSection,
  PageData,
} from './types'

export function Finance({ section: rawSection }: { section: string }) {
  const { t } = useTranslation()
  const section = asSection(rawSection)
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<FinanceFilters>({
    page: 1,
    pageSize: 20,
  })
  const [action, setAction] = useState<FinanceAction | null>(null)
  const debouncedKeyword = useDebounce(filters.keyword, 300)
  const queryFilters = useMemo(
    () => ({ ...filters, keyword: debouncedKeyword || undefined }),
    [filters, debouncedKeyword]
  )
  const query = useQuery<PageData<FinanceRecord>>({
    queryKey: ['finance', section, queryFilters],
    queryFn: async () => {
      if (section === 'topups') return getFinanceTopups(queryFilters)
      if (section === 'redemptions') return getFinanceRedemptions(queryFilters)
      if (section === 'rebates') return getFinanceRebates(queryFilters)
      return getFinancialOperations(queryFilters)
    },
    placeholderData: (previousData) => previousData,
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['finance'] })
    queryClient.invalidateQueries({ queryKey: ['self'] })
  }
  const items = (query.data?.items || []) as FinanceRecord[]
  const total = query.data?.total || 0
  const tabs = useMemo(() => Object.keys(sectionNames) as FinanceSection[], [])
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Finance')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          {section === 'operations' ? (
            <Button onClick={() => setAction({ kind: 'penalty' })}>
              {t('Apply penalty')}
            </Button>
          ) : null}
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-2 sm:gap-3'>
            <div className='flex shrink-0 items-center justify-between gap-2 border-b'>
              <div className='flex min-w-0 gap-1 overflow-x-auto'>
                {tabs.map((tab) => (
                  <Button
                    key={tab}
                    variant={tab === section ? 'secondary' : 'ghost'}
                    size='sm'
                    render={
                      <Link to='/finance/$section' params={{ section: tab }} />
                    }
                  >
                    {t(sectionNames[tab])}
                  </Button>
                ))}
              </div>
              <span className='text-muted-foreground hidden shrink-0 pr-1 text-xs tabular-nums sm:block'>
                {t('Total')}: {total}
              </span>
            </div>
            <FinanceTable
              section={section}
              filters={filters}
              setFilters={setFilters}
              items={items}
              total={total}
              isLoading={query.isLoading}
              isFetching={query.isFetching}
              onAction={setAction}
              onRefresh={refresh}
              className='min-h-0 flex-1'
            />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <FinanceActionDialog
        action={action}
        onClose={() => setAction(null)}
        onSuccess={refresh}
      />
    </>
  )
}
