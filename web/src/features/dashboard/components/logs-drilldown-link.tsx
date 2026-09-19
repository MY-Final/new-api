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
import { Link } from '@tanstack/react-router'
import { ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { buildLogsDrilldownSearch } from '@/features/dashboard/lib/drilldown'

interface LogsDrilldownLinkProps {
  start: Date
  end: Date
  model?: string
  channel?: number
  username?: string
  token?: string
  errorOnly?: boolean
  showLabel?: boolean
}

/**
 * Deep link from a dashboard metric into the usage logs page, carrying the
 * current time window plus the entity the metric belongs to.
 */
export function LogsDrilldownLink(props: LogsDrilldownLinkProps) {
  const { t } = useTranslation()
  const label = t('View logs')

  return (
    <Button
      type='button'
      variant='ghost'
      size='sm'
      className='text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5'
      title={label}
      aria-label={label}
      render={
        <Link
          to='/usage-logs/$section'
          params={{ section: 'common' }}
          search={buildLogsDrilldownSearch({
            start: props.start,
            end: props.end,
            model: props.model,
            channel: props.channel,
            username: props.username,
            token: props.token,
            errorOnly: props.errorOnly,
          })}
        />
      }
    >
      <ScrollText className='size-3.5' aria-hidden='true' />
      {props.showLabel ? <span>{label}</span> : null}
    </Button>
  )
}
