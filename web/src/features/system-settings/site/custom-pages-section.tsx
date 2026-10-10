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

import { Button } from '@/components/ui/button'
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
import {
  MAX_CUSTOM_PAGES,
  MAX_CUSTOM_PAGE_NAME_LENGTH,
  parseCustomPagesOption,
  serializeCustomPages,
  type CustomPage,
} from '@/lib/custom-pages'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

// FormMessage translates the message key without interpolation, so validation
// copy carries the literal limits that MAX_* currently enforce.
const NAME_TOO_LONG_MESSAGE = `Name cannot exceed ${MAX_CUSTOM_PAGE_NAME_LENGTH} characters`
const TOO_MANY_PAGES_MESSAGE = `At most ${MAX_CUSTOM_PAGES} pages are supported`

const customPagesSchema = z.object({
  pages: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, 'Name is required')
          .max(MAX_CUSTOM_PAGE_NAME_LENGTH, NAME_TOO_LONG_MESSAGE),
        url: z
          .string()
          .trim()
          .min(1, 'URL is required')
          .refine(
            (value) => /^https?:\/\/\S+$/i.test(value.trim()),
            'URL must start with http:// or https://'
          ),
        adminOnly: z.boolean(),
      })
    )
    .max(MAX_CUSTOM_PAGES, TOO_MANY_PAGES_MESSAGE),
})

type CustomPagesFormValues = z.infer<typeof customPagesSchema>

type CustomPagesSectionProps = {
  value: string
  initialSerialized: string
}

const toFormValues = (pages: CustomPage[]): CustomPagesFormValues => ({
  pages: pages.map((page) => ({ ...page })),
})

export function CustomPagesSection({
  value,
  initialSerialized,
}: CustomPagesSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const formDefaults = useMemo(
    () => toFormValues(parseCustomPagesOption(value)),
    [value]
  )

  const form = useForm<CustomPagesFormValues>({
    resolver: zodResolver(customPagesSchema),
    defaultValues: formDefaults,
  })

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const pages = useFieldArray({ control: form.control, name: 'pages' })
  const isFull = pages.fields.length >= MAX_CUSTOM_PAGES

  const onSubmit = async (values: CustomPagesFormValues) => {
    const serialized = serializeCustomPages(
      values.pages.map((page) => ({
        name: page.name.trim(),
        url: page.url.trim(),
        adminOnly: page.adminOnly,
      }))
    )
    if (serialized === initialSerialized) return

    await updateOption.mutateAsync({ key: 'CustomPages', value: serialized })
  }

  return (
    <SettingsSection title={t('Custom Pages')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            onReset={() => form.reset(toFormValues([]))}
            isSaving={updateOption.isPending}
            resetLabel='Clear all pages'
            saveLabel='Save custom pages'
          />

          <div className='space-y-3'>
            <div className='space-y-1'>
              <p className='text-sm font-medium'>{t('Embedded pages')}</p>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Each entry adds a sidebar menu item that opens the URL inside the console. Pages that refuse to be embedded can be opened in a new tab.'
                )}
              </p>
            </div>

            {pages.fields.length === 0 && (
              <p className='text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm'>
                {t('No custom pages yet. Add one to show it in the sidebar.')}
              </p>
            )}

            {pages.fields.map((field, index) => (
              <div
                key={field.id}
                className='grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]'
              >
                <FormField
                  control={form.control}
                  name={`pages.${index}.name`}
                  render={({ field: nameField }) => (
                    <FormItem>
                      <FormLabel>{t('Menu name')}</FormLabel>
                      <FormControl>
                        <Input
                          {...nameField}
                          placeholder={t('Status page')}
                          autoComplete='off'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`pages.${index}.url`}
                  render={({ field: urlField }) => (
                    <FormItem>
                      <FormLabel>{t('URL')}</FormLabel>
                      <FormControl>
                        <Input
                          {...urlField}
                          placeholder='https://status.example.com'
                          autoComplete='off'
                          inputMode='url'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='flex items-end gap-2'>
                  <FormField
                    control={form.control}
                    name={`pages.${index}.adminOnly`}
                    render={({ field: adminField }) => (
                      // Label above a control row as tall as the inputs, so all
                      // three columns share one label line and one control line.
                      <FormItem>
                        <FormLabel>{t('Admins only')}</FormLabel>
                        <div className='flex h-8 items-center'>
                          <FormControl>
                            <Switch
                              checked={adminField.value}
                              onCheckedChange={adminField.onChange}
                            />
                          </FormControl>
                        </div>
                      </FormItem>
                    )}
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={t('Remove page')}
                    onClick={() => pages.remove(index)}
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
              disabled={isFull}
              onClick={() => pages.append({ name: '', url: '', adminOnly: false })}
            >
              <Plus className='size-4' aria-hidden='true' />
              {t('Add page')}
            </Button>
            <FormDescription>
              {t(
                'Maximum {{count}} pages. Menu names must be unique; the page URL stays on the server for admin-only entries.',
                { count: MAX_CUSTOM_PAGES }
              )}
            </FormDescription>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
