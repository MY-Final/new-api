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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatQuotaPrecise, formatTimestamp } from '@/lib/format'

import { getFinancialOperations } from '../api'
import { ManualCreditForm } from './manual-credit-form'

export function ManualCreditWorkspace() {
  const { t } = useTranslation()
  const recent = useQuery({
    queryKey: ['finance', 'manual-credits'],
    queryFn: () =>
      getFinancialOperations({
        page: 1,
        pageSize: 10,
        operationType: 'manual_credit',
      }),
    meta: { errorToast: false },
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Manual credit')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
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
          <Card>
            <CardHeader>
              <CardTitle>{t('Recent manual credits')}</CardTitle>
            </CardHeader>
            <CardContent>
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
                    { id: 'id', header: t('ID'), cell: (row) => `#${row.id}` },
                    {
                      id: 'user',
                      header: t('User'),
                      cell: (row) =>
                        `${row.target_username} · #${row.target_user_id}`,
                    },
                    {
                      id: 'paid',
                      header: t('Paid credit'),
                      cell: (row) => formatQuotaPrecise(row.target_paid_delta),
                    },
                    {
                      id: 'bonus',
                      header: t('Promotional credit'),
                      cell: (row) => formatQuotaPrecise(row.target_bonus_delta),
                    },
                    {
                      id: 'reference',
                      header: t('Payment reference'),
                      cell: (row) => row.source_id || '—',
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
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
