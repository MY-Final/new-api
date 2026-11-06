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
*/
import { Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format'

import type { InviteCode } from '../types'

export function InviteCodeRegistrationsCell(props: {
  code: InviteCode
  locale: Intl.LocalesArgument
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const limit =
    props.code.registration_limit > 0
      ? formatNumber(props.code.registration_limit, props.locale)
      : t('Unlimited')

  return (
    <div className='min-w-[130px] space-y-1'>
      <div className='font-medium'>
        {formatNumber(props.code.registered_count, props.locale)} / {limit}
      </div>
      <div className='text-muted-foreground text-xs'>
        {props.code.registration_limit === 0
          ? t('No registration cap')
          : t('{{count}} remaining', {
              count: formatNumber(
                props.code.remaining_registrations,
                props.locale
              ),
            })}
      </div>
      <Button
        type='button'
        variant='link'
        size='sm'
        className='text-muted-foreground h-auto gap-1 p-0 text-xs font-normal'
        onClick={props.onOpen}
      >
        <Users aria-hidden='true' className='size-3.5' />
        {t('View registrations')}
      </Button>
    </div>
  )
}
