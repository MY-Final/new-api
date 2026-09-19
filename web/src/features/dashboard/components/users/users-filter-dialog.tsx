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
import { Calendar, Filter, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SectionDivider } from '@/features/dashboard/components/section-divider'
import { TIME_RANGE_PRESETS } from '@/features/dashboard/constants'
import { detectQuickRangeDays } from '@/features/dashboard/lib'
import type { UserChartsFilters } from '@/features/dashboard/types'
import { getRollingDateRange } from '@/lib/time'
import { cn } from '@/lib/utils'

// Mirrors the backend cap for user usage statistics
// (maxUsageStatisticsRangeSeconds in controller/user_usage_statistics.go).
const MAX_USER_ANALYTICS_RANGE_DAYS = 31

interface UsersFilterProps {
  filters: UserChartsFilters
  onFiltersChange: (filters: UserChartsFilters) => void
  onReset: () => void
}

export function UsersFilter(props: UsersFilterProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState<Date | undefined>(
    props.filters.range.start
  )
  const [end, setEnd] = useState<Date | undefined>(props.filters.range.end)

  const selectedRange = detectQuickRangeDays(start, end)
  const rangeTooLong = Boolean(
    start &&
    end &&
    end.getTime() - start.getTime() > MAX_USER_ANALYTICS_RANGE_DAYS * 86_400_000
  )
  const rangeReversed = Boolean(start && end && end.getTime() < start.getTime())
  const canApply = Boolean(start && end && !rangeTooLong && !rangeReversed)

  const handleOpenChange = (nextOpen: boolean) => {
    // Sync the draft from the applied filters every time the dialog opens so a
    // previously applied manual range is preserved.
    if (nextOpen) {
      setStart(props.filters.range.start)
      setEnd(props.filters.range.end)
    }
    setOpen(nextOpen)
  }

  const handleQuickRange = (days: number) => {
    const range = getRollingDateRange(days)
    setStart(range.start)
    setEnd(range.end)
  }

  const handleApply = () => {
    if (!start || !end || !canApply) return
    props.onFiltersChange({ ...props.filters, range: { start, end } })
    setOpen(false)
  }

  const handleReset = () => {
    props.onReset()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      trigger={
        <Button variant='outline' size='sm'>
          <Filter className='mr-2 h-4 w-4' />
          {t('Filter')}
        </Button>
      }
      title={t('User Analytics Filters')}
      description={t('Filter the user analytics view by time range.')}
      contentClassName='max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-lg'
      contentHeight='min(48vh, 460px)'
      footerClassName='grid grid-cols-2 gap-2 sm:flex'
      footer={
        <>
          <Button onClick={handleReset} variant='outline' type='button'>
            <RotateCcw className='mr-2 h-4 w-4' />
            {t('Reset')}
          </Button>
          <Button onClick={handleApply} type='submit' disabled={!canApply}>
            <Search className='mr-2 h-4 w-4' />
            {t('Apply Filters')}
          </Button>
        </>
      }
    >
      <ScrollArea className='h-full pr-3 sm:pr-4'>
        <div className='grid gap-2.5 py-2'>
          {/* Quick time range selection */}
          <div className='grid gap-2'>
            <Label className='flex items-center gap-2'>
              <Calendar className='h-4 w-4' />
              {t('Quick Range')}
            </Label>
            <div className='grid grid-cols-2 gap-2 sm:flex'>
              {TIME_RANGE_PRESETS.map((range) => (
                <Button
                  key={range.days}
                  type='button'
                  size='sm'
                  variant={selectedRange === range.days ? 'default' : 'outline'}
                  onClick={() => handleQuickRange(range.days)}
                  className={cn(
                    'flex-1',
                    selectedRange === range.days &&
                      'ring-ring ring-2 ring-offset-2'
                  )}
                >
                  {t(range.label)}
                </Button>
              ))}
            </div>
          </div>

          <SectionDivider label={t('Custom Time Range')} />

          {/* Custom time range */}
          <div className='grid gap-2.5'>
            <div className='grid gap-2'>
              <Label>{t('Start Time')}</Label>
              <DateTimePicker
                value={start}
                onChange={setStart}
                placeholder={t('Select start time')}
              />
            </div>

            <div className='grid gap-2'>
              <Label>{t('End Time')}</Label>
              <DateTimePicker
                value={end}
                onChange={setEnd}
                placeholder={t('Select end time')}
              />
            </div>

            {rangeReversed ? (
              <p className='text-destructive text-xs'>
                {t('End time must be after start time')}
              </p>
            ) : null}
            {rangeTooLong ? (
              <p className='text-destructive text-xs'>
                {t('Date range cannot exceed {{days}} days', {
                  days: MAX_USER_ANALYTICS_RANGE_DAYS,
                })}
              </p>
            ) : null}
          </div>
        </div>
      </ScrollArea>
    </Dialog>
  )
}
