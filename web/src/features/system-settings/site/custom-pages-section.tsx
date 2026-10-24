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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  CUSTOM_PAGE_HIGHLIGHT_COLORS,
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

const customPagesSchema = z.object({
  pages: z.array(
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
      highlight: z.boolean(),
      highlightColor: z.enum(CUSTOM_PAGE_HIGHLIGHT_COLORS).optional(),
      inWallet: z.boolean(),
    })
  ),
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

  const onSubmit = async (values: CustomPagesFormValues) => {
    const serialized = serializeCustomPages(
      values.pages.map((page) => ({
        name: page.name.trim(),
        url: page.url.trim(),
        adminOnly: page.adminOnly,
        highlight: page.highlight,
        ...(page.highlightColor ? { highlightColor: page.highlightColor } : {}),
        inWallet: page.inWallet,
      }))
    )
    if (serialized === initialSerialized) return

    await updateOption.mutateAsync({ key: 'CustomPages', value: serialized })
  }

  const colorOptions = [
    { value: '', label: t('Default'), swatch: 'bg-amber-400' },
    { value: 'blue', label: t('Blue'), swatch: 'bg-blue-500' },
    { value: 'green', label: t('Green'), swatch: 'bg-green-500' },
    { value: 'purple', label: t('Purple'), swatch: 'bg-purple-500' },
    { value: 'orange', label: t('Orange'), swatch: 'bg-orange-500' },
    { value: 'red', label: t('Red'), swatch: 'bg-red-500' },
  ]

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
              <p className='text-muted-foreground text-sm'>
                {t('Pages shown in the wallet are removed from the sidebar.')}
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
                <div className='flex flex-wrap items-end gap-2'>
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
                  <FormField
                    control={form.control}
                    name={`pages.${index}.highlight`}
                    render={({ field: highlightField }) => (
                      <FormItem>
                        <FormLabel>{t('Highlight in sidebar')}</FormLabel>
                        <div className='flex h-8 items-center'>
                          <FormControl>
                            <Switch
                              checked={highlightField.value}
                              onCheckedChange={highlightField.onChange}
                            />
                          </FormControl>
                        </div>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`pages.${index}.inWallet`}
                    render={({ field: walletField }) => (
                      <FormItem>
                        <FormLabel>{t('Show in wallet')}</FormLabel>
                        <div className='flex h-8 items-center'>
                          <FormControl>
                            <Switch
                              checked={walletField.value}
                              onCheckedChange={(checked) => {
                                walletField.onChange(checked)
                                // The wallet has one shop panel; enabling this
                                // page turns the flag off for the others.
                                if (checked) {
                                  pages.fields.forEach((_, otherIndex) => {
                                    if (otherIndex !== index) {
                                      form.setValue(
                                        `pages.${otherIndex}.inWallet`,
                                        false
                                      )
                                    }
                                  })
                                }
                              }}
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
                <FormField
                  control={form.control}
                  name={`pages.${index}.highlightColor`}
                  render={({ field: colorField }) => (
                    <FormItem className='lg:col-span-3'>
                      <FormLabel>{t('Highlight color')}</FormLabel>
                      <Select
                        items={colorOptions}
                        name={colorField.name}
                        value={colorField.value ?? ''}
                        onValueChange={colorField.onChange}
                        disabled={
                          !form.watch(`pages.${index}.highlight`) ||
                          updateOption.isPending
                        }
                      >
                        <FormControl>
                          <SelectTrigger
                            ref={colorField.ref}
                            onBlur={colorField.onBlur}
                            className='w-full sm:w-48'
                          >
                            <SelectValue>
                              {(value) => {
                                const selected =
                                  colorOptions.find(
                                    (option) => option.value === value
                                  ) ?? colorOptions[0]
                                return (
                                  <span className='flex items-center gap-2'>
                                    <span
                                      aria-hidden='true'
                                      className={`size-3 shrink-0 rounded-full ${selected.swatch}`}
                                    />
                                    {selected.label}
                                  </span>
                                )
                              }}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {colorOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                <span className='flex items-center gap-2'>
                                  <span
                                    aria-hidden='true'
                                    className={`size-3 shrink-0 rounded-full ${option.swatch}`}
                                  />
                                  {option.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>
            ))}

            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                pages.append({
                  name: '',
                  url: '',
                  adminOnly: false,
                  highlight: false,
                  inWallet: false,
                })
              }
            >
              <Plus className='size-4' aria-hidden='true' />
              {t('Add page')}
            </Button>
            <FormDescription>
              {t(
                'Menu names must be unique; the page URL stays on the server for admin-only entries.'
              )}
            </FormDescription>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
