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
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import type { RequestErrorLogFilters } from '../api'

export function ErrorRequestFilterBar(props: {
  filters: RequestErrorLogFilters
  onChange: (patch: Partial<RequestErrorLogFilters>) => void
  onSearch: () => void
  onReset: () => void
  isFetching: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Input
        className='w-56'
        aria-label={t('Request ID')}
        placeholder={t('Request ID')}
        value={props.filters.request_id ?? ''}
        onChange={(event) =>
          props.onChange({ request_id: event.target.value || undefined })
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onSearch()
        }}
      />
      <Input
        className='w-40'
        aria-label={t('Username')}
        placeholder={t('Username')}
        value={props.filters.username ?? ''}
        onChange={(event) =>
          props.onChange({ username: event.target.value || undefined })
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onSearch()
        }}
      />
      <Input
        className='w-40'
        aria-label={t('Model')}
        placeholder={t('Model')}
        value={props.filters.model_name ?? ''}
        onChange={(event) =>
          props.onChange({ model_name: event.target.value || undefined })
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onSearch()
        }}
      />
      <Input
        className='w-28'
        inputMode='numeric'
        aria-label={t('Channel')}
        placeholder={t('Channel')}
        value={props.filters.channel_id ?? ''}
        onChange={(event) => {
          if (!/^\d*$/.test(event.target.value)) return
          props.onChange({
            channel_id: event.target.value
              ? Number(event.target.value)
              : undefined,
          })
        }}
      />
      <Input
        className='w-28'
        inputMode='numeric'
        aria-label={t('Status')}
        placeholder={t('Status')}
        value={props.filters.status_code ?? ''}
        onChange={(event) => {
          if (!/^\d*$/.test(event.target.value)) return
          props.onChange({
            status_code: event.target.value
              ? Number(event.target.value)
              : undefined,
          })
        }}
      />
      <Input
        className='w-56'
        aria-label={t('Error keyword')}
        placeholder={t('Error keyword')}
        value={props.filters.keyword ?? ''}
        onChange={(event) =>
          props.onChange({ keyword: event.target.value || undefined })
        }
        onKeyDown={(event) => {
          if (event.key === 'Enter') props.onSearch()
        }}
      />
      <Button size='sm' onClick={props.onSearch} disabled={props.isFetching}>
        <Search className='size-4' />
        {t('Search')}
      </Button>
      <Button size='sm' variant='outline' onClick={props.onReset}>
        <X className='size-4' />
        {t('Reset')}
      </Button>
    </div>
  )
}
