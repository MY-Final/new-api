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
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type {
  SubscriptionUsageFilterOptions,
  SubscriptionUsageRecordFilters,
} from '../types'

interface FilterSelectProps {
  label: string
  value: string
  items: { value: string; label: string }[]
  onChange: (value: string) => void
}

function FilterSelect(props: FilterSelectProps) {
  return (
    <div className='min-w-0'>
      <div className='text-muted-foreground mb-1 text-[11px] font-medium'>
        {props.label}
      </div>
      <Select
        items={props.items}
        value={props.value}
        onValueChange={(value) => value !== null && props.onChange(value)}
      >
        <SelectTrigger className='h-8 w-full min-w-0' aria-label={props.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {props.items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

interface SubscriptionUsageFiltersProps {
  filters: SubscriptionUsageRecordFilters
  options: SubscriptionUsageFilterOptions
  onChange: (filters: SubscriptionUsageRecordFilters) => void
}

export function SubscriptionUsageFilters(props: SubscriptionUsageFiltersProps) {
  const { t } = useTranslation()
  const hasFilters =
    props.filters.modelName != null ||
    props.filters.subscriptionId != null ||
    props.filters.tokenId != null ||
    props.filters.channelId != null

  const modelItems = [
    { value: 'all', label: t('All models') },
    ...props.options.models.map((model) => ({
      value: model,
      label: model,
    })),
  ]
  const subscriptionItems = [
    { value: 'all', label: t('All subscriptions') },
    ...props.options.subscriptions.map((subscription) => ({
      value: String(subscription.id),
      label: subscription.plan_title || `#${subscription.id}`,
    })),
  ]
  const tokenItems = [
    { value: 'all', label: t('All tokens') },
    ...props.options.tokens.map((token) => ({
      value: String(token.id),
      label: token.name || `#${token.id}`,
    })),
  ]
  const channelItems = [
    { value: 'all', label: t('All channels') },
    ...props.options.channels.map((channel) => ({
      value: String(channel.id),
      label: channel.name || `#${channel.id}`,
    })),
  ]

  return (
    <div className='space-y-2'>
      <div className='text-sm font-medium'>{t('Filters')}</div>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <FilterSelect
          label={t('Model')}
          value={props.filters.modelName ?? 'all'}
          items={modelItems}
          onChange={(value) =>
            props.onChange({
              ...props.filters,
              modelName: value === 'all' ? undefined : value,
            })
          }
        />
        <FilterSelect
          label={t('Subscription')}
          value={
            props.filters.subscriptionId == null
              ? 'all'
              : String(props.filters.subscriptionId)
          }
          items={subscriptionItems}
          onChange={(value) =>
            props.onChange({
              ...props.filters,
              subscriptionId:
                value === 'all' ? undefined : Number.parseInt(value, 10),
            })
          }
        />
        <FilterSelect
          label={t('Token')}
          value={
            props.filters.tokenId == null
              ? 'all'
              : String(props.filters.tokenId)
          }
          items={tokenItems}
          onChange={(value) =>
            props.onChange({
              ...props.filters,
              tokenId: value === 'all' ? undefined : Number.parseInt(value, 10),
            })
          }
        />
        <FilterSelect
          label={t('Channel')}
          value={
            props.filters.channelId == null
              ? 'all'
              : String(props.filters.channelId)
          }
          items={channelItems}
          onChange={(value) =>
            props.onChange({
              ...props.filters,
              channelId:
                value === 'all' ? undefined : Number.parseInt(value, 10),
            })
          }
        />
      </div>
      {hasFilters && (
        <Button
          variant='ghost'
          size='sm'
          className='h-7 px-2'
          onClick={() => props.onChange({})}
        >
          <X className='size-3.5' aria-hidden='true' />
          {t('Clear filters')}
        </Button>
      )}
    </div>
  )
}
