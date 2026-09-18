import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { cn } from '@/lib/utils'

import {
  filterPlaceholder,
  filterUserLabel,
  getCodeTypeOptions,
  getOperationTypeLabel,
  getOperationTypeOptions,
  getProviderOptions,
  getStatusLabel,
  getStatusOptions,
} from '../lib/labels'
import type { FinanceFilters, FinanceSection } from '../types'

export function FinanceFilterBar(props: {
  section: FinanceSection
  filters: FinanceFilters
  setFilters: (value: FinanceFilters) => void
  className?: string
}) {
  const { t } = useTranslation()
  const [range, setRange] = useState<{ start?: Date; end?: Date }>({})

  const update = (key: keyof FinanceFilters, value: string) => {
    props.setFilters({
      ...props.filters,
      page: 1,
      [key]: value === '' ? undefined : value,
    })
  }

  const selectFilter = (
    key: keyof FinanceFilters,
    value: string | null | undefined
  ) => {
    props.setFilters({
      ...props.filters,
      page: 1,
      [key]: value === 'all' ? undefined : value || undefined,
    })
  }

  const hasActiveFilters = Boolean(
    props.filters.keyword ||
    props.filters.userId ||
    props.filters.inviterId ||
    props.filters.inviteeId ||
    props.filters.operatorId ||
    props.filters.sourceType ||
    props.filters.status ||
    props.filters.provider ||
    props.filters.operationType ||
    props.filters.startTime ||
    props.filters.endTime
  )

  const clearFilters = () => {
    setRange({})
    props.setFilters({ page: 1, pageSize: props.filters.pageSize })
  }

  const statusOptions = getStatusOptions(props.section, t)
  const statusLabel = getStatusLabel(props.filters.status || 'all', t)
  const userFilterKey = props.section === 'rebates' ? 'inviterId' : 'operatorId'
  const userFilterLabel = filterUserLabel(props.section, t)
  const keywordPlaceholder = filterPlaceholder(props.section, t)
  const operationTypeOptions = getOperationTypeOptions(t)
  const providerOptions = getProviderOptions(t)
  const codeTypeOptions = getCodeTypeOptions(t)
  const providerLabel =
    providerOptions.find(
      (option) => option.value === (props.filters.provider || 'all')
    )?.label ?? t('All providers')
  const codeTypeLabel =
    codeTypeOptions.find(
      (option) => option.value === (props.filters.sourceType || 'all')
    )?.label ?? t('All types')

  return (
    <div className={cn('flex flex-wrap items-center gap-2', props.className)}>
      <Input
        className='w-full sm:w-56'
        value={props.filters.keyword || ''}
        aria-label={keywordPlaceholder}
        placeholder={keywordPlaceholder}
        onChange={(event) => update('keyword', event.target.value)}
      />
      {(props.section === 'topups' || props.section === 'redemptions') && (
        <Input
          className='w-full sm:w-36'
          type='number'
          min={1}
          value={props.filters.userId || ''}
          aria-label={t('User ID')}
          placeholder={t('User ID')}
          onChange={(event) => update('userId', event.target.value)}
        />
      )}
      {(props.section === 'rebates' || props.section === 'operations') && (
        <Input
          className='w-full sm:w-36'
          type='number'
          min={1}
          value={props.filters[userFilterKey] || ''}
          aria-label={userFilterLabel}
          placeholder={userFilterLabel}
          onChange={(event) => update(userFilterKey, event.target.value)}
        />
      )}
      {props.section === 'operations' ? (
        <Select
          items={operationTypeOptions}
          value={props.filters.operationType || 'all'}
          onValueChange={(value) => selectFilter('operationType', value)}
        >
          <SelectTrigger className='w-full sm:w-auto'>
            <SelectValue>
              {props.filters.operationType
                ? getOperationTypeLabel(props.filters.operationType, t)
                : t('All operation types')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {operationTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : (
        <Select
          items={statusOptions}
          value={props.filters.status || 'all'}
          onValueChange={(value) => selectFilter('status', value)}
        >
          <SelectTrigger className='w-full sm:w-auto'>
            <SelectValue>{statusLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {props.section === 'topups' && (
        <Select
          items={providerOptions}
          value={props.filters.provider || 'all'}
          onValueChange={(value) => selectFilter('provider', value)}
        >
          <SelectTrigger className='w-full sm:w-auto'>
            <SelectValue>{providerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {providerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {props.section === 'redemptions' && (
        <Select
          items={codeTypeOptions}
          value={props.filters.sourceType || 'all'}
          onValueChange={(value) => selectFilter('sourceType', value)}
        >
          <SelectTrigger className='w-full sm:w-auto'>
            <SelectValue>{codeTypeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {codeTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      <CompactDateTimeRangePicker
        start={range.start}
        end={range.end}
        className='w-full sm:w-72'
        onChange={(next) => {
          setRange(next)
          props.setFilters({
            ...props.filters,
            page: 1,
            startTime: next.start
              ? Math.floor(next.start.getTime() / 1000)
              : undefined,
            endTime: next.end
              ? Math.floor(next.end.getTime() / 1000)
              : undefined,
          })
        }}
      />
      {hasActiveFilters ? (
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground'
          onClick={clearFilters}
        >
          <X aria-hidden='true' />
          {t('Clear filters')}
        </Button>
      ) : null}
    </div>
  )
}
