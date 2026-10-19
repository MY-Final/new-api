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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'

import type { UsageSources } from '../types'

export function UsageSourceNotice(props: {
  sources?: UsageSources
  detailed?: boolean
}) {
  const { t } = useTranslation()
  const sources = props.sources
  if (!sources) return null

  const estimated =
    sources.input_tokens === 'estimated' ||
    sources.output_tokens === 'estimated'
  let label = ''
  if (estimated) {
    label = t('Includes estimates')
  } else if (
    sources.input_tokens === 'unavailable' &&
    sources.output_tokens === 'unavailable'
  ) {
    label = t('Usage not reported')
  }

  const missingCache = !props.detailed && sources.cache_tokens === 'unavailable'
  if (!label && sources.final && !missingCache) return null

  return (
    <div className='text-muted-foreground space-y-1 text-xs [overflow-wrap:anywhere]'>
      {(label || !sources.final) && (
        <div className='flex flex-wrap items-center gap-1.5'>
          {label && (
            <StatusBadge
              label={label}
              variant={estimated ? 'warning' : 'neutral'}
              size='sm'
            />
          )}
          {!sources.final && <span>{t('Final usage not received')}</span>}
        </div>
      )}
      {missingCache && <p>{t('Cache usage not reported')}</p>}
      {props.detailed && (!sources.final || estimated) && (
        <p>
          {t(
            'Output estimates count received content only. Unreported cache and reasoning usage is unknown.'
          )}
        </p>
      )}
    </div>
  )
}
