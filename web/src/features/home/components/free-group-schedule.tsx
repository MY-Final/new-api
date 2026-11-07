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
import { CalendarDays } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { enUS } from 'react-day-picker/locale'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { calendarLocales } from '@/lib/calendar-locale'
import dayjs from '@/lib/dayjs'

import { useFreeGroupSchedule } from '../hooks/use-free-group-schedule'

const sourceLabelKeys = {
  date: 'Date override',
  weekly: 'Weekly',
  default: 'Default group',
} as const

export function FreeGroupScheduleDialog() {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => dayjs().startOf('month').toDate())
  const [selected, setSelected] = useState<Date | undefined>(() =>
    dayjs().toDate()
  )
  const from = dayjs(month).startOf('month').format('YYYY-MM-DD')
  const to = dayjs(month).endOf('month').format('YYYY-MM-DD')
  const schedule = useFreeGroupSchedule(from, to, open)
  const calendarLocale =
    calendarLocales[i18n.language as keyof typeof calendarLocales] ?? enUS
  const daysByDate = useMemo(
    () => new Map((schedule.data?.days ?? []).map((day) => [day.date, day])),
    [schedule.data?.days]
  )
  const selectedDate = selected
    ? dayjs(selected).format('YYYY-MM-DD')
    : undefined
  const selectedDay = selectedDate ? daysByDate.get(selectedDate) : undefined
  const scheduledDates = (schedule.data?.days ?? [])
    .filter((day) => day.source !== 'default')
    .map((day) => dayjs(day.date).toDate())

  let summary: ReactNode
  if (schedule.isLoading) {
    summary = <Skeleton className='h-20 w-full' />
  } else if (schedule.isError || !schedule.data) {
    summary = (
      <p className='text-muted-foreground text-sm'>{t('Unavailable')}</p>
    )
  } else {
    summary = (
      <div className='grid gap-3 sm:grid-cols-2'>
        <div
          role='group'
          aria-label={t('Today')}
          className='rounded-lg border px-3 py-2'
        >
          <p className='text-muted-foreground text-xs'>{t('Today')}</p>
          <p className='mt-1 font-semibold'>
            {schedule.data.today_group || t('Not scheduled')}
          </p>
        </div>
        <div
          role='group'
          aria-label={t('Tomorrow')}
          className='rounded-lg border px-3 py-2'
        >
          <p className='text-muted-foreground text-xs'>{t('Tomorrow')}</p>
          <p className='mt-1 font-semibold'>
            {schedule.data.tomorrow_group || t('Not scheduled')}
          </p>
        </div>
      </div>
    )
  }

  let selectedDetail: ReactNode
  if (selectedDay) {
    selectedDetail = (
      <>
        <span className='tabular-nums'>{selectedDay.date}</span>
        <Badge variant='outline'>{selectedDay.group}</Badge>
        <span className='text-muted-foreground text-xs'>
          {t(sourceLabelKeys[selectedDay.source])}
        </span>
      </>
    )
  } else if (schedule.isLoading) {
    selectedDetail = <Skeleton className='h-5 w-40' />
  } else {
    selectedDetail = (
      <span className='text-muted-foreground'>
        {t('Select a day to see its group.')}
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant='outline' size='sm' />}>
        <CalendarDays className='size-4' aria-hidden='true' />
        {t('View schedule')}
      </DialogTrigger>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Free group schedule')}</DialogTitle>
          <DialogDescription>
            {t('See which group is free on each day.')}
          </DialogDescription>
        </DialogHeader>

        {summary}

        <Calendar
          mode='single'
          month={month}
          onMonthChange={setMonth}
          selected={selected}
          onSelect={setSelected}
          locale={calendarLocale}
          modifiers={{ scheduled: scheduledDates }}
          modifiersClassNames={{
            scheduled:
              'font-bold text-orange-700 dark:text-orange-300 [&_button]:bg-orange-500/10',
          }}
        />

        <div className='flex min-h-10 flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm'>
          {selectedDetail}
        </div>

        <p className='text-muted-foreground text-xs'>
          {t('Highlighted dates use a scheduled group.')}{' '}
          {t('The daily limit resets at midnight UTC+8.')}
        </p>
      </DialogContent>
    </Dialog>
  )
}
