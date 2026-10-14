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

import { StatusBadge, type StatusVariant } from '@/components/status-badge'

import { ticketStatuses } from '../constants'
import type { TicketStatus } from '../types'

const appearances: Record<
  TicketStatus,
  { variant: StatusVariant; background: string }
> = {
  pending: { variant: 'warning', background: 'bg-warning/10' },
  processing: { variant: 'info', background: 'bg-info/10' },
  waiting: { variant: 'purple', background: 'bg-chart-4/10' },
  resolved: { variant: 'success', background: 'bg-success/10' },
  closed: { variant: 'neutral', background: 'bg-muted' },
}

export function TicketStatusBadge(props: { status: TicketStatus }) {
  const { t } = useTranslation()
  const appearance = appearances[props.status]
  return (
    <StatusBadge
      label={t(ticketStatuses[props.status])}
      variant={appearance.variant}
      className={appearance.background}
      copyable={false}
      type='badge'
      showDot
    />
  )
}
