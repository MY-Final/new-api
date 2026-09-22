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
import { ImageIcon } from 'lucide-react'
import type { Resolver } from 'react-hook-form'
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
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsFormGrid,
  SettingsFormGridItem,
  SettingsForm,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSettingsForm } from '../hooks/use-settings-form'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  ContactQRCodeError,
  encodeContactQRCode,
} from '../utils/contact-qrcode'

export type ContactFormValues = {
  contact: {
    title: string
    description: string
    qq_group_number: string
    qq_group_url: string
    qrcode: string
  }
}

type ContactSectionProps = {
  defaultValues: ContactFormValues
}

export function ContactSection({ defaultValues }: ContactSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const schema = z.object({
    contact: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      qq_group_number: z.string().optional(),
      qq_group_url: z
        .string()
        .refine((value) => !value.trim() || /^https?:\/\//.test(value.trim()), {
          error: () =>
            t('Provide a valid URL starting with http:// or https://'),
        }),
      qrcode: z.string().optional(),
    }),
  })

  const { form, handleSubmit, handleReset, isDirty, isSubmitting } =
    useSettingsForm<ContactFormValues>({
      resolver: zodResolver(schema) as Resolver<
        ContactFormValues,
        unknown,
        ContactFormValues
      >,
      defaultValues,
      onSubmit: async (_data, changedFields) => {
        for (const [key, value] of Object.entries(changedFields)) {
          await updateOption.mutateAsync({
            key,
            value: typeof value === 'string' ? value : String(value ?? ''),
          })
        }
      },
    })

  const handleQRCodeFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const dataURI = await encodeContactQRCode(file)
      form.setValue('contact.qrcode', dataURI, { shouldDirty: true })
      form.clearErrors('contact.qrcode')
    } catch (error) {
      let message = t('Failed to read the image file.')
      if (error instanceof ContactQRCodeError) {
        message =
          error.reason === 'too_large'
            ? t('Image exceeds the 512 KiB limit.')
            : t('Image must be a PNG or JPEG file.')
      }
      form.setError('contact.qrcode', { message })
    }
  }

  return (
    <SettingsSection title={t('Contact Information')}>
      <Form {...form}>
        <SettingsForm onSubmit={handleSubmit}>
          <SettingsPageFormActions
            onSave={handleSubmit}
            onReset={handleReset}
            isSaving={isSubmitting || updateOption.isPending}
            isResetDisabled={!isDirty}
          />
          <SettingsFormGrid>
            <FormField
              control={form.control}
              name='contact.title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Contact title')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('Contact Us')}
                      autoComplete='off'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Leave empty to use the default text.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='contact.qq_group_number'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('QQ Group Number')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('e.g., 123456789')}
                      autoComplete='off'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Leave empty to hide this item.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='contact.description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Contact description')}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} autoComplete='off' {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Leave empty to use the default text.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='contact.qq_group_url'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('QQ group join link')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='https://example.com'
                      autoComplete='off'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Leave empty to hide this item.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SettingsFormGridItem span='full'>
              <FormField
                control={form.control}
                name='contact.qrcode'
                render={({ field }) => (
                  <FormItem data-settings-form-span='full'>
                    <FormLabel>{t('QR code image')}</FormLabel>
                    <div className='flex flex-wrap items-center gap-3'>
                      {field.value ? (
                        <img
                          src={field.value}
                          alt={t('QR code image')}
                          className='bg-muted/30 size-16 rounded-md border object-contain p-1'
                        />
                      ) : (
                        <span className='bg-muted/30 text-muted-foreground flex size-16 items-center justify-center rounded-md border'>
                          <ImageIcon className='size-5' aria-hidden='true' />
                        </span>
                      )}
                      <Input
                        type='file'
                        accept='image/png,image/jpeg,.png,.jpg,.jpeg'
                        aria-label={t('QR code image')}
                        className='max-w-72'
                        onChange={(event) => {
                          void handleQRCodeFile(event.target.files?.[0])
                          event.target.value = ''
                        }}
                      />
                      {field.value ? (
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          onClick={() => field.onChange('')}
                        >
                          {t('Remove')}
                        </Button>
                      ) : null}
                    </div>
                    <FormDescription>
                      {t(
                        'PNG or JPEG, up to 512 KiB. Leave empty to hide the QR code.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SettingsFormGridItem>
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
