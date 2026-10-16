import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useDebounce } from '@/hooks/use-debounce'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getFinanceRebates,
  getFinanceRedemptions,
  getFinanceTopups,
  getFinancialOperations,
} from './api'
import { FinanceActionDialog } from './components/finance-action-dialog'
import { FinanceDetailDialog } from './components/finance-detail-dialog'
import { FinanceTable } from './components/finance-table'
import { RefundNavigation } from './components/refund-navigation'
import {
  ExportTooLargeError,
  MAX_EXPORT_ROWS,
  exportFinanceCsv,
} from './lib/export'
import { asSection, sectionNames } from './lib/labels'
import type {
  FinanceAction,
  FinanceFilters,
  FinanceRecord,
  PageData,
} from './types'

export function Finance({ section: rawSection }: { section: string }) {
  const { t } = useTranslation()
  const cashRefunds = rawSection === 'cash-refunds'
  const [cashSource, setCashSource] = useState<'topups' | 'redemptions'>(
    'topups'
  )
  const section = cashRefunds ? cashSource : asSection(rawSection)
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<FinanceFilters>({
    page: 1,
    pageSize: 20,
  })
  const [action, setAction] = useState<FinanceAction | null>(null)
  const [detail, setDetail] = useState<FinanceRecord | null>(null)
  const [isExporting, setIsExporting] = useState(false)
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
    placeholderData: (previousData, previousQuery) =>
      !cashRefunds && previousQuery?.queryKey[1] === section
        ? previousData
        : undefined,
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['finance'] })
    queryClient.invalidateQueries({ queryKey: ['self'] })
  }
  const handleExport = async () => {
    setIsExporting(true)
    try {
      const rows = await exportFinanceCsv(section, queryFilters, t)
      toast.success(t('Exported {{count}} rows', { count: rows }))
    } catch (error) {
      if (error instanceof ExportTooLargeError) {
        toast.error(
          t('Export is limited to {{count}} rows; narrow the filters', {
            count: MAX_EXPORT_ROWS,
          })
        )
      } else {
        handleServerError(error, t('Failed to export'))
      }
    } finally {
      setIsExporting(false)
    }
  }

  const items = (query.data?.items || []) as FinanceRecord[]
  const total = query.data?.total || 0
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {cashRefunds
            ? t('Offline refund registration')
            : t(sectionNames[section])}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            disabled={isExporting || total === 0}
            onClick={handleExport}
          >
            <Download className='size-4' aria-hidden='true' />
            {isExporting ? t('Exporting...') : t('Export CSV')}
          </Button>
          {section === 'operations' ? (
            <Button onClick={() => setAction({ kind: 'penalty' })}>
              {t('Apply penalty')}
            </Button>
          ) : null}
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col gap-2 sm:gap-3'>
            {cashRefunds ? (
              <>
                <RefundNavigation active='cash' />
                <div className='bg-muted/40 shrink-0 rounded-lg border px-3 py-2 text-sm'>
                  <p className='font-medium'>
                    {t('Cash returned externally → balance deducted here')}
                  </p>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t(
                      'Find the original top-up or paid redemption, verify the balance deduction, then register the completed external refund. No payment is sent from this page.'
                    )}
                  </p>
                </div>
              </>
            ) : null}
            {cashRefunds ? (
              <div className='flex shrink-0 items-center justify-between gap-2 border-b'>
                <div className='flex min-w-0 gap-1 overflow-x-auto'>
                  {(['topups', 'redemptions'] as const).map((source) => (
                    <Button
                      key={source}
                      variant={source === section ? 'secondary' : 'ghost'}
                      size='sm'
                      aria-pressed={source === section}
                      onClick={() => {
                        setCashSource(source)
                        setFilters({ page: 1, pageSize: filters.pageSize })
                        setDetail(null)
                        setAction(null)
                      }}
                    >
                      {t(sectionNames[source])}
                    </Button>
                  ))}
                </div>
                <span className='text-muted-foreground hidden shrink-0 pr-1 text-xs tabular-nums sm:block'>
                  {t('Total')}: {total}
                </span>
              </div>
            ) : null}
            {query.isError ? (
              <ErrorState onRetry={() => void query.refetch()} />
            ) : (
              <FinanceTable
                key={section}
                section={section}
                cashRefunds={cashRefunds}
                filters={filters}
                setFilters={setFilters}
                items={items}
                total={total}
                isLoading={query.isLoading}
                isFetching={query.isFetching}
                onAction={setAction}
                onRefresh={refresh}
                onDetails={setDetail}
                className='min-h-0 flex-1'
              />
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <FinanceDetailDialog
        section={section}
        item={detail}
        onClose={() => setDetail(null)}
      />
      <FinanceActionDialog
        action={action}
        onClose={() => setAction(null)}
        onSuccess={refresh}
      />
    </>
  )
}
