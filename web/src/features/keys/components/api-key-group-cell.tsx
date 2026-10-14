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
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { handleServerError } from '@/lib/handle-server-error'

import { updateApiKeyGroup } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  ApiKeyGroupOptions,
  type ApiKeyGroupOption,
} from './api-key-group-combobox'
import { GroupRatioBadge, type GroupRatio } from './auto-group-visuals'

type ApiKeyGroupCellProps = {
  apiKeyId: number
  crossGroupRetry: boolean
  group: string
  options: ApiKeyGroupOption[]
  ratio?: GroupRatio
  shouldReduceMotion: boolean
}

export function ApiKeyGroupCell(props: ApiKeyGroupCellProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const group = props.group?.trim() || ''
  const isAuto = group === 'auto'
  const ratio =
    group && typeof props.ratio === 'number' ? props.ratio : undefined

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setSearchValue('')
  }

  const handleSelect = async (nextGroup: string) => {
    handleOpenChange(false)
    if (nextGroup === group) return

    setIsSaving(true)
    try {
      const result = await updateApiKeyGroup(props.apiKeyId, nextGroup)
      if (result.success) {
        toast.success(t(SUCCESS_MESSAGES.API_KEY_GROUP_UPDATED))
        await queryClient.invalidateQueries({ queryKey: ['keys'] })
      } else {
        handleServerError(result, t(ERROR_MESSAGES.GROUP_UPDATE_FAILED))
      }
    } catch (error) {
      handleServerError(error, t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setIsSaving(false)
    }
  }

  let indicator = (
    <ChevronDown aria-hidden='true' className='size-3.5 shrink-0 opacity-50' />
  )
  if (isSaving) {
    indicator = (
      <Loader2
        aria-hidden='true'
        className='size-3.5 shrink-0 animate-spin opacity-50'
      />
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type='button'
            aria-label={t('Change group')}
            aria-expanded={open}
            disabled={isSaving}
            title={group || t('Follow user group')}
            className='focus-visible:ring-ring/40 hover:bg-muted/60 flex w-full max-w-full min-w-0 items-center justify-between gap-3 rounded-md px-1 py-0.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60 sm:w-auto'
          />
        }
      >
        {isAuto ? (
          <span
            data-api-key-group-cell='auto'
            className='flex min-w-0 items-center gap-3'
          >
            <StatusBadge
              label={t('Cross-group')}
              variant='info'
              copyable={false}
              className='px-0'
            />
            <GroupRatioBadge
              ratio={props.ratio}
              isAuto
              shouldReduceMotion={props.shouldReduceMotion}
            />
          </span>
        ) : (
          <span data-api-key-group-cell='group' className='min-w-0'>
            <GroupBadge
              group={group}
              ratio={ratio}
              ratioLabel={group ? undefined : t('Inherited')}
              type='text'
              wrap
              className='px-0'
              containerClassName='flex-wrap gap-x-3 gap-y-1'
            />
          </span>
        )}
        {indicator}
      </PopoverTrigger>
      <PopoverContent
        align='start'
        collisionPadding={16}
        className='w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-0'
      >
        <ApiKeyGroupOptions
          options={props.options}
          value={group}
          onSelect={handleSelect}
          searchValue={searchValue}
          onSearchValueChange={setSearchValue}
        />
      </PopoverContent>
    </Popover>
  )
}
