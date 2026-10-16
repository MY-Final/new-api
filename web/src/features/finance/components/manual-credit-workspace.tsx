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
import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableServerPagination,
  StaticDataTable,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebounce } from '@/hooks/use-debounce'
import { useMediaQuery } from '@/hooks/use-media-query'
import { formatQuotaPrecise, formatTimestamp } from '@/lib/format'

import { getFinancialOperations } from '../api'
import { paymentChannels } from '../lib/manual-credit'
import type { FinanceFilters } from '../types'
import { FinanceFilterBar } from './finance-filter-bar'
import { ManualCreditForm } from './manual-credit-form'

export function ManualCreditWorkspace() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('recent')
  const [filters, setFilters] = useState<FinanceFilters>({
    page: 1,
    pageSize: 20,
  })
  const recordsRef = useRef<HTMLDivElement>(null)
  const isMobile = useMediaQuery('(max-width: 640px)')
  const keyword = useDebounce(filters.keyword?.trim(), 300)
  const history = tab === 'history'
  const queryFilters: FinanceFilters = history
    ? {
        ...filters,
        keyword: keyword || undefined,
        operationType: 'manual_credit',
      }
    : { page: 1, pageSize: 10, operationType: 'manual_credit' }
  const recent = useQuery({
    queryKey: ['finance', 'manual-credits', queryFilters],
    queryFn: () => getFinancialOperations(queryFilters),
    meta: { errorToast: false },
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Manual credit')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          onClick={() => {
            setTab('history')
            recordsRef.current?.scrollIntoView({ block: 'start' })
            recordsRef.current?.focus({ preventScroll: true })
          }}
        >
          {t('Credit history')}
        </Button>
        <Button
          variant='outline'
          render={
            <Link to='/finance/$section' params={{ section: 'operations' }} />
          }
        >
          {t('Financial Operations')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <ManualCreditForm />
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <Card
              ref={recordsRef}
              tabIndex={-1}
              className='min-w-0 scroll-mt-4'
            >
              <CardHeader>
                <TabsList className='max-w-full'>
                  <TabsTrigger value='recent'>
                    {t('Recent manual credits')}
                  </TabsTrigger>
                  <TabsTrigger value='history'>
                    {t('Credit history')}
                  </TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className='min-w-0 space-y-4'>
                <TabsContent
                  value={tab}
                  className='space-y-4'
                  aria-busy={recent.isFetching}
                >
                  {history ? (
                    <FinanceFilterBar
                      section='operations'
                      manualCredits
                      filters={filters}
                      setFilters={setFilters}
                    />
                  ) : null}
                  {recent.isPending ? <LoadingState /> : null}
                  {recent.isError ? (
                    <ErrorState onRetry={() => void recent.refetch()} />
                  ) : null}
                  {recent.data ? (
                    <StaticDataTable
                      data={recent.data.items}
                      getRowKey={(row) => row.id}
                      emptyContent={
                        <EmptyState
                          className='min-h-40'
                          title={t('No financial records found')}
                        />
                      }
                      columns={[
                        {
                          id: 'id',
                          header: t('ID'),
                          cell: (row) => `#${row.id}`,
                        },
                        {
                          id: 'user',
                          header: t('User'),
                          cell: (row) =>
                            `${row.target_username} · #${row.target_user_id}`,
                        },
                        {
                          id: 'paid',
                          header: t('Paid credit'),
                          cell: (row) =>
                            formatQuotaPrecise(row.target_paid_delta),
                        },
                        {
                          id: 'bonus',
                          header: t('Promotional credit'),
                          cell: (row) =>
                            formatQuotaPrecise(row.target_bonus_delta),
                        },
                        {
                          id: 'reference',
                          header: t('Payment reference'),
                          cell: (row) => row.source_id || '—',
                        },
                        {
                          id: 'paymentChannel',
                          header: t('Payment channel'),
                          cell: (row) => {
                            const channel = paymentChannels.find(
                              (item) => item.value === row.payment_channel
                            )
                            return channel ? (
                              <StatusBadge
                                copyable={false}
                                variant={channel.variant}
                                className={channel.className}
                                label={t(channel.label)}
                              />
                            ) : (
                              '—'
                            )
                          },
                        },
                        {
                          id: 'reason',
                          header: t('Reason'),
                          cell: (row) => row.reason,
                        },
                        {
                          id: 'operator',
                          header: t('Operator'),
                          cell: (row) =>
                            row.operator_username || `#${row.operator_id}`,
                        },
                        {
                          id: 'time',
                          header: t('Time'),
                          cell: (row) => formatTimestamp(row.created_at),
                        },
                      ]}
                    />
                  ) : null}
                  {history && recent.data && !recent.isError ? (
                    <DataTableServerPagination
                      compact={isMobile}
                      page={filters.page}
                      pageSize={filters.pageSize}
                      total={recent.data.total}
                      onPageChange={(page) => setFilters({ ...filters, page })}
                      onPageSizeChange={(pageSize) =>
                        setFilters({ ...filters, page: 1, pageSize })
                      }
                    />
                  ) : null}
                </TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
