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
import type { Table } from '@tanstack/react-table'
import { Edit, Loader2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { getEditableQuotaStep, parseQuotaFromDollars } from '@/lib/format'

import { batchRedemptionOperation } from '../api'
import { REDEMPTION_STATUS } from '../constants'
import type { Redemption } from '../types'
import { useRedemptions } from './redemptions-provider'

type DataTableBulkActionsProps<TData> = {
  table: Table<TData>
}

export function DataTableBulkActions<TData>({
  table,
}: DataTableBulkActionsProps<TData>) {
  const { t } = useTranslation()
  const { triggerRefresh } = useRedemptions()
  const selectedRows = table.getSelectedRowModel().rows
  const selectedRedemptions = useMemo(
    () => selectedRows.map((row) => row.original as Redemption),
    [selectedRows]
  )
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [fields, setFields] = useState({
    name: false,
    type: false,
    paidQuota: false,
    bonusQuota: false,
    status: false,
  })
  const [name, setName] = useState('')
  const [type, setType] = useState<'paid' | 'reward'>('reward')
  const [paidQuota, setPaidQuota] = useState('')
  const [bonusQuota, setBonusQuota] = useState('')
  const [status, setStatus] = useState('1')
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const quotaStep = getEditableQuotaStep()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const hasLockedSelection = selectedRedemptions.some(
    (redemption) => redemption.status >= REDEMPTION_STATUS.USED
  )

  const contentToCopy = useMemo(() => {
    const selectedCodes = selectedRows.map((row) => {
      const redemption = row.original as Redemption
      return `${redemption.name}\t${redemption.key}`
    })
    return selectedCodes.join('\n')
  }, [selectedRows])

  const resetEditor = () => {
    setFields({
      name: false,
      type: false,
      paidQuota: false,
      bonusQuota: false,
      status: false,
    })
    setName('')
    setType('reward')
    setPaidQuota('')
    setBonusQuota('')
    setStatus('1')
  }

  const handleUpdate = async () => {
    const data: Parameters<typeof batchRedemptionOperation>[0] = {
      ids: selectedRedemptions.map((redemption) => redemption.id),
      operation: 'update',
    }
    if (fields.name) {
      if (!name.trim()) {
        toast.error(t('Name is required'))
        return
      }
      data.name = name.trim()
    }
    if (fields.type) data.type = type
    if (fields.paidQuota) {
      const parsedPaidQuota = parseQuotaFromDollars(
        Number.parseFloat(paidQuota)
      )
      if (parsedPaidQuota < 0) {
        toast.error(t('Quota must not be negative'))
        return
      }
      data.paid_quota = parsedPaidQuota
    }
    if (fields.bonusQuota) {
      const parsedBonusQuota = parseQuotaFromDollars(
        Number.parseFloat(bonusQuota)
      )
      if (parsedBonusQuota < 0) {
        toast.error(t('Quota must not be negative'))
        return
      }
      data.bonus_quota = parsedBonusQuota
    }
    if (fields.status) data.status = Number(status)
    if (
      !fields.name &&
      !fields.type &&
      !fields.paidQuota &&
      !fields.bonusQuota &&
      !fields.status
    ) {
      toast.error(t('Select at least one field to update'))
      return
    }

    setIsSubmitting(true)
    try {
      const result = await batchRedemptionOperation(data)
      if (!result.success) {
        throw new Error(result.message || t('Batch update failed'))
      }
      toast.success(t('Redemption codes updated successfully'))
      table.resetRowSelection()
      setEditOpen(false)
      resetEditor()
      triggerRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Batch update failed')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const result = await batchRedemptionOperation({
        ids: selectedRedemptions.map((redemption) => redemption.id),
        operation: 'delete',
      })
      if (!result.success) {
        throw new Error(result.message || t('Batch delete failed'))
      }
      toast.success(t('Redemption codes deleted successfully'))
      table.resetRowSelection()
      setDeleteOpen(false)
      triggerRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Batch delete failed')
      )
    } finally {
      setIsDeleting(false)
    }
  }

  const openEditor = () => {
    if (hasLockedSelection) {
      toast.error(
        t('Please select only unused redemption codes for batch operations')
      )
      return
    }
    setEditOpen(true)
  }

  const openDeleteDialog = () => {
    if (hasLockedSelection) {
      toast.error(
        t('Please select only unused redemption codes for batch operations')
      )
      return
    }
    setDeleteOpen(true)
  }

  return (
    <>
      <BulkActionsToolbar table={table} entityName={t('redemption code')}>
        <CopyButton
          value={contentToCopy}
          variant='outline'
          size='icon'
          className='size-8'
          tooltip={t('Copy selected codes')}
          successTooltip={t('Codes copied!')}
          aria-label={t('Copy selected codes')}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                onClick={openEditor}
                disabled={hasLockedSelection}
                aria-label={t('Edit')}
              />
            }
          >
            <Edit />
          </TooltipTrigger>
          <TooltipContent>{t('Edit')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='outline'
                size='icon'
                className='text-destructive hover:text-destructive size-8'
                onClick={openDeleteDialog}
                disabled={hasLockedSelection}
                aria-label={t('Delete')}
              />
            }
          >
            <Trash2 />
          </TooltipTrigger>
          <TooltipContent>{t('Delete')}</TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>

      <Sheet
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open)
          if (!open) resetEditor()
        }}
      >
        <SheetContent className='sm:max-w-[520px]'>
          <SheetHeader>
            <SheetTitle>{t('Edit selected redemption codes')}</SheetTitle>
            <SheetDescription>
              {t('Choose the fields to update for all selected codes.')}
            </SheetDescription>
          </SheetHeader>
          <div className='grid gap-5 overflow-y-auto p-4'>
            <div className='text-muted-foreground text-sm'>
              {t('Selected')}: {selectedRedemptions.length}
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-3'>
                <Checkbox
                  id='bulk-change-name'
                  checked={fields.name}
                  onCheckedChange={(checked) =>
                    setFields((current) => ({ ...current, name: !!checked }))
                  }
                />
                <Label htmlFor='bulk-change-name'>{t('Change name')}</Label>
              </div>
              <div className='pl-7'>
                <Input
                  aria-label={t('Change name')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={!fields.name}
                  placeholder={t('Enter a name')}
                  maxLength={20}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-3'>
                <Checkbox
                  id='bulk-change-type-enabled'
                  checked={fields.type}
                  onCheckedChange={(checked) =>
                    setFields((current) => ({ ...current, type: !!checked }))
                  }
                />
                <Label htmlFor='bulk-change-type-enabled'>
                  {t('Change type')}
                </Label>
              </div>
              <div className='pl-7'>
                <Select
                  items={[
                    { value: 'reward', label: t('Reward code') },
                    { value: 'paid', label: t('Paid code') },
                  ]}
                  value={type}
                  onValueChange={(value) =>
                    setType(value === 'paid' ? 'paid' : 'reward')
                  }
                  disabled={!fields.type}
                >
                  <SelectTrigger
                    id='bulk-change-type-value'
                    aria-label={t('Change type')}
                    className='w-full'
                  >
                    <SelectValue className='min-w-0 truncate'>
                      {type === 'paid' ? t('Paid code') : t('Reward code')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='reward'>{t('Reward code')}</SelectItem>
                      <SelectItem value='paid'>{t('Paid code')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-3'>
                <Checkbox
                  id='bulk-change-paid-quota-enabled'
                  checked={fields.paidQuota}
                  onCheckedChange={(checked) =>
                    setFields((current) => ({
                      ...current,
                      paidQuota: !!checked,
                    }))
                  }
                />
                <Label htmlFor='bulk-change-paid-quota-enabled'>
                  {t('Change paid quota')}
                </Label>
              </div>
              <div className='pl-7'>
                <Input
                  aria-label={t('Change paid quota')}
                  type='number'
                  min='0'
                  step={quotaStep}
                  value={paidQuota}
                  onChange={(event) => setPaidQuota(event.target.value)}
                  disabled={!fields.paidQuota}
                  placeholder={
                    tokensOnly
                      ? t('Enter paid quota in tokens')
                      : t('Enter paid quota in {{currency}}', {
                          currency: currencyLabel,
                        })
                  }
                />
              </div>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-3'>
                <Checkbox
                  id='bulk-change-bonus-quota-enabled'
                  checked={fields.bonusQuota}
                  onCheckedChange={(checked) =>
                    setFields((current) => ({
                      ...current,
                      bonusQuota: !!checked,
                    }))
                  }
                />
                <Label htmlFor='bulk-change-bonus-quota-enabled'>
                  {t('Change bonus quota')}
                </Label>
              </div>
              <div className='pl-7'>
                <Input
                  aria-label={t('Change bonus quota')}
                  type='number'
                  min='0'
                  step={quotaStep}
                  value={bonusQuota}
                  onChange={(event) => setBonusQuota(event.target.value)}
                  disabled={!fields.bonusQuota}
                  placeholder={
                    tokensOnly
                      ? t('Enter bonus quota in tokens')
                      : t('Enter bonus quota in {{currency}}', {
                          currency: currencyLabel,
                        })
                  }
                />
              </div>
            </div>
            <div className='space-y-2'>
              <div className='flex items-center gap-3'>
                <Checkbox
                  id='bulk-change-status-enabled'
                  checked={fields.status}
                  onCheckedChange={(checked) =>
                    setFields((current) => ({ ...current, status: !!checked }))
                  }
                />
                <Label htmlFor='bulk-change-status-enabled'>
                  {t('Change status')}
                </Label>
              </div>
              <div className='pl-7'>
                <Select
                  items={[
                    { value: '1', label: t('Unused') },
                    { value: '2', label: t('Disabled') },
                  ]}
                  value={status}
                  onValueChange={(value) => setStatus(value || '1')}
                  disabled={!fields.status}
                >
                  <SelectTrigger
                    id='bulk-change-status-value'
                    aria-label={t('Change status')}
                    className='w-full'
                  >
                    <SelectValue className='min-w-0 truncate'>
                      {status === '2' ? t('Disabled') : t('Unused')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='1'>{t('Unused')}</SelectItem>
                      <SelectItem value='2'>{t('Disabled')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <SheetFooter>
            <SheetClose
              render={<Button variant='outline' disabled={isSubmitting} />}
            >
              {t('Cancel')}
            </SheetClose>
            <Button onClick={handleUpdate} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className='animate-spin' />}
              {t('Save changes')}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => !open && !isDeleting && setDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Are you sure?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('This will permanently delete redemption codes')} (
              {selectedRedemptions.length})
              {t('. This action cannot be undone.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('Cancel')}
            </AlertDialogCancel>
            <Button
              variant='destructive'
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className='animate-spin' />}
              {t('Delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
