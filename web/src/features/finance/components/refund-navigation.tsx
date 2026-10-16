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
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export function RefundNavigation(props: { active: 'requests' | 'cash' }) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('Refund type')}
      className='grid shrink-0 grid-cols-2 gap-2'
    >
      {[
        {
          section: 'refunds',
          active: 'requests',
          title: t('Consumption refunds'),
          description: t(
            'Return request charges to the original funding source'
          ),
          icon: ArrowDownLeft,
        },
        {
          section: 'cash-refunds',
          active: 'cash',
          title: t('Offline refund registration'),
          description: t(
            'Record an external cash refund and deduct the credited balance'
          ),
          icon: ArrowUpRight,
        },
      ].map((item) => (
        <Link
          key={item.section}
          to='/finance/$section'
          params={{ section: item.section }}
          aria-current={props.active === item.active ? 'page' : undefined}
          className={cn(
            'flex min-w-0 items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            props.active === item.active && 'border-primary/40 bg-primary/5'
          )}
        >
          <item.icon className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <div className='min-w-0'>
            <p className='text-sm font-medium'>{item.title}</p>
            <p className='text-muted-foreground mt-1 hidden text-xs sm:block'>
              {item.description}
            </p>
          </div>
        </Link>
      ))}
    </nav>
  )
}
