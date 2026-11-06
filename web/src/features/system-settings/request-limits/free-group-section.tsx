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
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

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

const schema = z
  .object({
    enabled: z.boolean(),
    group: z.string().trim(),
    daily_limit: z.number().int().min(1).max(1_000_000_000),
    user_limit: z.number().int().min(0).max(1_000_000_000),
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
  const defaults = useMemo<FreeGroupValues>(() => {
    try {
      const parsed = schema.safeParse(JSON.parse(props.setting))
      if (parsed.success) return parsed.data
    } catch {
      // Invalid settings are surfaced by the backend when saving.
    }
    return { enabled: false, group: '', daily_limit: 10000, user_limit: 0 }
  }, [props.setting])
  const form = useForm<FreeGroupValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  useEffect(() => {
    form.reset(defaults)
  }, [defaults, form])

  const onSubmit = async (values: FreeGroupValues) => {
    if (values.enabled && !groups.includes(values.group)) {
      form.setError('group', { message: 'Choose an existing group' })
      return
    }
    await updateOption.mutateAsync({
      key: 'FreeGroupSetting',
      value: JSON.stringify(values),
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
            {t('The daily limit resets at midnight Beijing time.')}
          </p>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
