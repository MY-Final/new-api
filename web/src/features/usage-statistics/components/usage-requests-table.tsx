/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTableServerPagination } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatQuota, formatTimestamp } from '@/lib/format'

import { getUserUsageRequests, type UsageStatisticsParams } from '../api'

interface UsageRequestsTableProps {
  endpoint: string
  params: Omit<UsageStatisticsParams, 'p' | 'page_size' | 'sort_by'>
  queryKey: string
}

export function UsageRequestsTable(props: UsageRequestsTableProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const requestParams = {
    ...props.params,
    p: page,
    page_size: pageSize,
  }
  const requestsQuery = useQuery({
    queryKey: [
      'usage-statistics',
      props.queryKey,
      props.endpoint,
      requestParams,
    ],
    queryFn: async () => {
      const result = await getUserUsageRequests(props.endpoint, requestParams)
      if (!result.success || !result.data) {
        throw new Error(result.message || t('Failed to load request details'))
      }
      return result.data
    },
    placeholderData: (previous) => previous,
  })

  if (requestsQuery.isError) {
    return (
      <ErrorState
        className='min-h-40'
        title={t('Failed to load request details')}
        description={
          requestsQuery.error instanceof Error
            ? requestsQuery.error.message
            : undefined
        }
        onRetry={() => requestsQuery.refetch()}
      />
    )
  }

  const data = requestsQuery.data
  let tableBody: ReactNode
  if (requestsQuery.isLoading) {
    tableBody = (
      <TableRow>
        <TableCell
          colSpan={12}
          className='text-muted-foreground h-20 text-center'
        >
          {t('Loading...')}
        </TableCell>
      </TableRow>
    )
  } else if (data?.items.length) {
    tableBody = data.items.map((item) => (
      <TableRow key={`${item.created_at}-${item.request_id}`}>
        <TableCell className='whitespace-nowrap tabular-nums'>
          {formatTimestamp(item.created_at)}
        </TableCell>
        <TableCell
          className='max-w-40 truncate font-mono text-xs'
          title={item.request_id}
        >
          {item.request_id || '-'}
        </TableCell>
        <TableCell className='max-w-44 truncate' title={item.model_name}>
          {item.model_name || '-'}
        </TableCell>
        <TableCell className='max-w-36 truncate' title={item.channel_name}>
          {item.channel_name || (item.channel_id ? `#${item.channel_id}` : '-')}
        </TableCell>
        <TableCell>{item.success ? t('Success') : t('Failed')}</TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.input_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.output_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.cache_read_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.cache_write_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.reasoning_tokens)}
        </TableCell>
        <TableCell className='text-right tabular-nums'>
          {formatNumber(item.total_tokens)}
        </TableCell>
        <TableCell className='text-right font-medium tabular-nums'>
          {formatQuota(item.user_cost)}
        </TableCell>
      </TableRow>
    ))
  } else {
    tableBody = (
      <TableRow>
        <TableCell
          colSpan={12}
          className='text-muted-foreground h-20 text-center'
        >
          {t('No request records')}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='overflow-x-auto rounded-lg border'>
        <Table className='min-w-[1180px]'>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Time')}</TableHead>
              <TableHead>{t('Request ID')}</TableHead>
              <TableHead>{t('Model')}</TableHead>
              <TableHead>{t('Channel')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead className='text-right'>{t('Input Tokens')}</TableHead>
              <TableHead className='text-right'>{t('Output Tokens')}</TableHead>
              <TableHead className='text-right'>{t('Cache Read')}</TableHead>
              <TableHead className='text-right'>{t('Cache Write')}</TableHead>
              <TableHead className='text-right'>{t('Reasoning')}</TableHead>
              <TableHead className='text-right'>{t('Total Tokens')}</TableHead>
              <TableHead className='text-right'>{t('User Cost')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{tableBody}</TableBody>
        </Table>
      </div>
      <DataTableServerPagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPage(1)
          setPageSize(nextPageSize)
        }}
      />
    </div>
  )
}
