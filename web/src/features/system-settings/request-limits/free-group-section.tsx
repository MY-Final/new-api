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
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { DatePicker } from '@/components/date-picker'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeJsonParse } from '../utils/json-parser'
import { safeNumberFieldProps } from '../utils/numeric-field'

const MAX_SCHEDULE_DAYS = 366

const schema = z
  .object({
    enabled: z.boolean(),
    group: z.string().trim(),
    daily_limit: z.number().int().min(1).max(1_000_000_000),
    user_limit: z.number().int().min(0).max(1_000_000_000),
    weekly: z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          group: z.string().trim(),
        })
      )
      .max(7),
    schedule: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          group: z.string().trim().min(1, 'Choose an existing group'),
        })
      )
      .max(MAX_SCHEDULE_DAYS),
  })
  .refine(
    (value) => !value.enabled || (value.group !== '' && value.group !== 'auto'),
    {
      path: ['group'],
      message: 'Choose an existing group',
    }
  )

type FreeGroupValues = z.infer<typeof schema>

export function FreeGroupSection(props: {
  setting: string
  used: number
  groupRatio: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const updateOption = useUpdateOption()
  const groups = useMemo(() => {
    const parsed = z
      .record(z.string(), z.number())
      .safeParse(safeJsonParse(props.groupRatio, { fallback: {} }))
    return parsed.success
      ? Object.keys(parsed.data).filter((group) => group !== 'auto')
      : []
  }, [props.groupRatio])
  const weekdayNames = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'long' })
    return Array.from({ length: 7 }, (_, weekday) =>
      formatter.format(new Date(2026, 10, 1 + weekday))
    )
  }, [locale])
  const defaults = useMemo<FreeGroupValues>(() => {
    let base: FreeGroupValues = {
      enabled: false,
      group: '',
      daily_limit: 10000,
      user_limit: 0,
      weekly: [],
      schedule: [],
    }
    try {
      const raw = JSON.parse(props.setting)
      const parsed = schema.safeParse({
        ...raw,
        weekly: Array.isArray(raw.weekly) ? raw.weekly : [],
        schedule: Array.isArray(raw.schedule) ? raw.schedule : [],
      })
      if (parsed.success) base = parsed.data
    } catch {
      // Invalid settings are surfaced by the backend when saving.
    }
    return {
      ...base,
      weekly: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        group:
          base.weekly.find((slot) => slot.weekday === weekday)?.group ?? '',
      })),
      schedule: [...base.schedule].sort((left, right) =>
        left.date.localeCompare(right.date)
      ),
    }
  }, [props.setting])
  const form = useForm<FreeGroupValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  const scheduleFields = useFieldArray({
    control: form.control,
    name: 'schedule',
  })
  useEffect(() => {
    form.reset(defaults)
  }, [defaults, form])

  const groupOptions = [
    { value: '', label: t('Default group') },
    ...groups.map((group) => ({ value: group, label: group })),
  ]

  const onSubmit = async (values: FreeGroupValues) => {
    if (values.enabled && !groups.includes(values.group)) {
      form.setError('group', { message: 'Choose an existing group' })
      return
    }
    let invalid = false
    values.weekly.forEach((slot, index) => {
      if (slot.group && !groups.includes(slot.group)) {
        form.setError(`weekly.${index}.group`, {
          message: 'Choose an existing group',
        })
        invalid = true
      }
    })
    const dates = new Set<string>()
    values.schedule.forEach((slot, index) => {
      if (!groups.includes(slot.group)) {
        form.setError(`schedule.${index}.group`, {
          message: 'Choose an existing group',
        })
        invalid = true
      }
      if (dates.has(slot.date)) {
        form.setError(`schedule.${index}.date`, {
          message: 'This date already has an override',
        })
        invalid = true
      }
      dates.add(slot.date)
    })
    if (invalid) return

    const weekly = values.weekly.filter((slot) => slot.group)
    const schedule = [...values.schedule].sort((left, right) =>
      left.date.localeCompare(right.date)
    )
    await updateOption.mutateAsync({
      key: 'FreeGroupSetting',
      value: JSON.stringify({
        enabled: values.enabled,
        group: values.group,
        daily_limit: values.daily_limit,
        user_limit: values.user_limit,
        ...(weekly.length > 0 ? { weekly } : {}),
        ...(schedule.length > 0 ? { schedule } : {}),
      }),
    })
  }

  return (
    <SettingsSection title={t('Free group')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save free group settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable free group')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Calls in this group share the daily site limit and do not charge users.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <SettingsFormGrid className='items-start'>
            <FormField
              control={form.control}
              name='group'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Group Name')}</FormLabel>
                  <FormControl>
                    <Combobox
                      className='h-8 w-full'
                      options={groups.map((group) => ({
                        value: group,
                        label: group,
                      }))}
                      value={field.value}
                      onValueChange={(value) => {
                        if (value !== null) field.onChange(value)
                      }}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      placeholder={
                        groups.length === 0
                          ? t('No group found.')
                          : t('Select a group')
                      }
                      disabled={groups.length === 0}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Choose an existing group')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='daily_limit'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Daily site limit')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      max={1000000000}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='user_limit'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Daily limit per user')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      max={1000000000}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Set to 0 for no per-user limit.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>

          <div className='grid gap-3'>
            <div>
              <h4 className='text-sm font-medium'>{t('Weekly schedule')}</h4>
              <p className='text-muted-foreground text-xs'>
                {t('Leave a weekday on the default group.')}
              </p>
            </div>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              {weekdayNames.map((weekdayName, weekday) => (
                <FormField
                  key={weekdayName}
                  control={form.control}
                  name={`weekly.${weekday}.group`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{weekdayName}</FormLabel>
                      <FormControl>
                        <Combobox
                          className='h-8 w-full'
                          options={groupOptions}
                          value={field.value}
                          onValueChange={(value) => {
                            if (value !== null) field.onChange(value)
                          }}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          placeholder={t('Default group')}
                          disabled={groups.length === 0}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </div>

          <div className='grid gap-3'>
            <div>
              <h4 className='text-sm font-medium'>{t('Date overrides')}</h4>
              <p className='text-muted-foreground text-xs'>
                {t('A date override wins over the weekly schedule.')}
              </p>
            </div>
            {scheduleFields.fields.length === 0 && (
              <p className='text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm'>
                {t('No date overrides yet.')}
              </p>
            )}
            {scheduleFields.fields.map((field, index) => (
              <div
                key={field.id}
                className='grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]'
              >
                <FormField
                  control={form.control}
                  name={`schedule.${index}.date`}
                  render={({ field: dateField }) => (
                    <FormItem>
                      <FormLabel>{t('Date')}</FormLabel>
                      <FormControl>
                        <DatePicker
                          selected={
                            dateField.value
                              ? dayjs(dateField.value).toDate()
                              : undefined
                          }
                          onSelect={(date) => {
                            if (date) {
                              dateField.onChange(
                                dayjs(date).format('YYYY-MM-DD')
                              )
                            }
                          }}
                          disabled={(date) => date < new Date('1900-01-01')}
                          placeholder={t('Pick a date')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`schedule.${index}.group`}
                  render={({ field: groupField }) => (
                    <FormItem>
                      <FormLabel>{t('Group Name')}</FormLabel>
                      <FormControl>
                        <Combobox
                          className='h-8 w-full'
                          options={groups.map((group) => ({
                            value: group,
                            label: group,
                          }))}
                          value={groupField.value}
                          onValueChange={(value) => {
                            if (value !== null) groupField.onChange(value)
                          }}
                          onBlur={groupField.onBlur}
                          ref={groupField.ref}
                          placeholder={
                            groups.length === 0
                              ? t('No group found.')
                              : t('Select a group')
                          }
                          disabled={groups.length === 0}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='flex items-end'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={t('Remove override')}
                    onClick={() => scheduleFields.remove(index)}
                  >
                    <Trash2 className='size-4' aria-hidden='true' />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={scheduleFields.fields.length >= MAX_SCHEDULE_DAYS}
              onClick={() =>
                scheduleFields.append({
                  date: dayjs().format('YYYY-MM-DD'),
                  group: form.getValues('group') || groups[0] || '',
                })
              }
            >
              <Plus className='size-4' aria-hidden='true' />
              {t('Add date override')}
            </Button>
          </div>

          <p className='text-muted-foreground text-sm'>
            {t('Used today: {{used}}', {
              used: formatNumber(props.used, locale),
            })}{' '}
            {t('Remaining today: {{remaining}}', {
              remaining: formatNumber(
                Math.max(0, defaults.daily_limit - props.used),
                locale
              ),
            })}{' '}
            {t('The daily limit resets at midnight UTC+8.')}
          </p>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
