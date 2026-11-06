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
import { getRouteApi } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
  useDataTable,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getInviteCodes, updateInviteCode } from './api'
import { InviteCodeClaimsDialog } from './components/invite-code-claims-dialog'
import { useInviteCodesColumns } from './components/invite-codes-columns'
import { InviteCodesMutateDrawer } from './components/invite-codes-mutate-drawer'
import type { InviteCode } from './types'

const route = getRouteApi('/_authenticated/invite-codes/')

export function InviteCodes() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [mutateOpen, setMutateOpen] = useState(false)
  const [currentRow, setCurrentRow] = useState<InviteCode | null>(null)
  const [claimsCode, setClaimsCode] = useState<InviteCode | null>(null)

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })

  const enabledFilter =
    (
      columnFilters.find((filter) => filter.id === 'status')?.value as
        | string[]
        | undefined
    )?.[0] ?? ''
  let enabled: boolean | undefined
  if (enabledFilter === 'enabled') {
    enabled = true
  } else if (enabledFilter === 'disabled') {
    enabled = false
  }

  const inviteCodesQuery = useQuery({
    queryKey: [
      'invite-codes',
      'list',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      enabled,
    ],
    queryFn: async () => {
      const response = requireServerSuccess(
        await getInviteCodes({
          p: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
          keyword: globalFilter?.trim() || undefined,
          enabled,
        })
      )
      return response.data ?? { items: [], total: 0, page: 1, page_size: 20 }
    },
    placeholderData: (previousData) => previousData,
  })

  const toggleMutation = useMutation({
    mutationFn: async (code: InviteCode) =>
      requireServerSuccess(
        await updateInviteCode(code.id, { enabled: !code.enabled })
      ),
    onSuccess: (_response, code) => {
      toast.success(
        t(code.enabled ? 'Invitation code disabled' : 'Invitation code enabled')
      )
      void queryClient.invalidateQueries({
        queryKey: ['invite-codes', 'list'],
      })
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  const openCreate = () => {
    setCurrentRow(null)
    setMutateOpen(true)
  }
  const openEdit = (code: InviteCode) => {
    setCurrentRow(code)
    setMutateOpen(true)
  }
  const handleMutateOpenChange = (open: boolean) => {
    setMutateOpen(open)
    if (!open) setCurrentRow(null)
  }
  const invalidateInviteCodes = () => {
    void queryClient.invalidateQueries({ queryKey: ['invite-codes', 'list'] })
  }
  const getRowClassName = (
    row: { original: InviteCode },
    context: { isMobile: boolean }
  ) => {
    if (row.original.enabled) return undefined
    return context.isMobile ? DISABLED_ROW_MOBILE : DISABLED_ROW_DESKTOP
  }

  const columns = useInviteCodesColumns({
    onEdit: openEdit,
    onClaims: setClaimsCode,
    onToggle: (code) => toggleMutation.mutate(code),
    togglingId: toggleMutation.isPending
      ? toggleMutation.variables?.id
      : undefined,
  })
  const { table } = useDataTable({
    data: inviteCodesQuery.data?.items ?? [],
    columns,
    columnFilters,
    globalFilter,
    pagination,
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: inviteCodesQuery.data?.total ?? 0,
    ensurePageInRange,
  })

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Invitation Codes')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button type='button' onClick={openCreate}>
            <Plus />
            {t('Create invitation code')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={inviteCodesQuery.isLoading}
            isFetching={inviteCodesQuery.isFetching}
            emptyTitle={t('No invitation codes found')}
            emptyDescription={t(
              'Create a campaign code with its own registration capacity and reward.'
            )}
            emptyAction={
              <Button type='button' onClick={openCreate}>
                <Plus />
                {t('Create invitation code')}
              </Button>
            }
            skeletonKeyPrefix='invite-codes-skeleton'
            applyHeaderSize
            className='min-h-0 flex-1'
            toolbarProps={{
              searchPlaceholder: t('Filter by campaign or code...'),
              searchDebounceMs: 500,
              filters: [
                {
                  columnId: 'status',
                  title: t('Status'),
                  singleSelect: true,
                  options: [
                    { label: t('Enabled'), value: 'enabled' },
                    { label: t('Disabled'), value: 'disabled' },
                  ],
                },
              ],
            }}
            getRowClassName={getRowClassName}
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <InviteCodesMutateDrawer
        open={mutateOpen}
        onOpenChange={handleMutateOpenChange}
        currentRow={currentRow}
        onSaved={invalidateInviteCodes}
      />
      <InviteCodeClaimsDialog
        code={claimsCode}
        open={Boolean(claimsCode)}
        onOpenChange={(open) => {
          if (!open) setClaimsCode(null)
        }}
      />
    </>
  )
}
