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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import {
  clearRequestErrorLogs,
  deleteRequestErrorLog,
  getRequestErrorLogs,
  type RequestErrorLog,
  type RequestErrorLogFilters,
} from './api'
import { useErrorRequestColumns } from './components/error-request-columns'
import { ErrorRequestDetailDialog } from './components/error-request-detail-dialog'
import { ErrorRequestFilterBar } from './components/error-request-filter-bar'

const EMPTY_ENTRIES: RequestErrorLog[] = []

function hasActiveFilters(filters: RequestErrorLogFilters): boolean {
  return Boolean(
    filters.request_id ||
    filters.username ||
    filters.model_name ||
    filters.channel_id ||
    filters.status_code ||
    filters.keyword
  )
}

export function ErrorRequests() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<RequestErrorLogFilters>({
    p: 1,
    page_size: 20,
  })
  const [detailId, setDetailId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RequestErrorLog | null>(null)
  const [clearOpen, setClearOpen] = useState(false)

  const query = useQuery({
    queryKey: ['error-requests', filters],
    queryFn: () => getRequestErrorLogs(filters),
    retry: false,
  })

  const columns = useErrorRequestColumns({
    onView: (entry) => setDetailId(entry.id),
    onDelete: (entry) => setDeleteTarget(entry),
  })
  const { table } = useDataTable({
    columns,
    data: query.data?.items ?? EMPTY_ENTRIES,
    getRowId: (entry) => String(entry.id),
    totalCount: query.data?.total ?? 0,
    pagination: { pageIndex: filters.p - 1, pageSize: filters.page_size },
    onPaginationChange: (updater) => {
      if (query.isFetching) return
      setFilters((previous) => {
        const current = {
          pageIndex: previous.p - 1,
          pageSize: previous.page_size,
        }
        const next = typeof updater === 'function' ? updater(current) : updater
        return {
          ...previous,
          p: next.pageSize === previous.page_size ? next.pageIndex + 1 : 1,
          page_size: next.pageSize,
        }
      })
    },
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteRequestErrorLog(id),
    onSuccess: () => {
      toast.success(t('Deleted'))
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['error-requests'] })
    },
    onError: (error) => {
      handleServerError(error, t('Failed to delete error request'))
    },
  })
  const clearMutation = useMutation({
    mutationFn: () =>
      clearRequestErrorLogs(filters, !hasActiveFilters(filters)),
    onSuccess: (deleted) => {
      toast.success(t('Deleted {{count}} records', { count: deleted }))
      setClearOpen(false)
      setFilters((previous) => ({ ...previous, p: 1 }))
      void queryClient.invalidateQueries({ queryKey: ['error-requests'] })
    },
    onError: (error) => {
      handleServerError(error, t('Failed to clear error requests'))
    },
  })

  const updateFilters = (patch: Partial<RequestErrorLogFilters>) =>
    setFilters((previous) => ({ ...previous, ...patch, p: 1 }))

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Error Requests')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          size='sm'
          variant='destructive'
          onClick={() => setClearOpen(true)}
          disabled={query.isPending}
        >
          {t('Clear captured logs')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={query.isPending}
            isFetching={query.isFetching}
            emptyTitle={t('No error requests')}
            className='h-auto min-h-0 flex-1'
            paginationInFooter
            toolbar={
              <div className='shrink-0 space-y-2'>
                <ErrorRequestFilterBar
                  filters={filters}
                  onChange={updateFilters}
                  onSearch={() => void query.refetch()}
                  onReset={() =>
                    setFilters({ p: 1, page_size: filters.page_size })
                  }
                  isFetching={query.isFetching}
                />
                {query.isError && (
                  <Alert variant='destructive'>
                    <AlertDescription className='flex items-center justify-between gap-2'>
                      <span>{t('Failed to load error requests')}</span>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => void query.refetch()}
                      >
                        {t('Retry')}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            }
          />
        </div>
        <ErrorRequestDetailDialog
          id={detailId}
          onOpenChange={(open) => {
            if (!open) setDetailId(null)
          }}
        />

        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          title={t('Delete error request')}
          desc={t('Delete this captured request? This cannot be undone.')}
          destructive
          isLoading={deleteMutation.isPending}
          handleConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          }}
        />

        <ConfirmDialog
          open={clearOpen}
          onOpenChange={setClearOpen}
          title={t('Clear captured logs')}
          desc={
            hasActiveFilters(filters)
              ? t('Delete every captured request matching the current filters?')
              : t('Delete every captured request? This cannot be undone.')
          }
          destructive
          isLoading={clearMutation.isPending}
          handleConfirm={() => clearMutation.mutate()}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
