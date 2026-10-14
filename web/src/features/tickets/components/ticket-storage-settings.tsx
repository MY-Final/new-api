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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import { getTicketStorage, saveTicketStorage } from '../api'
import type { TicketStorageSettings } from '../types'

const schema = z.object({
  notify_email: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === '' ||
        value.split(';').every((part) => /^[^\s@]+@[^\s@]+$/.test(part.trim())),
      'Enter a valid notification email address'
    ),
  enabled: z.boolean(),
  retention_days: z
    .number({ error: 'Image retention must be between 1 and 365 days' })
    .int('Image retention must be between 1 and 365 days')
    .min(1, 'Image retention must be between 1 and 365 days')
    .max(365, 'Image retention must be between 1 and 365 days'),
  endpoint: z.string().trim(),
  bucket: z.string().trim(),
  access_key: z.string(),
  secret_key: z.string(),
})
type StorageValues = z.infer<typeof schema>

export function TicketStorageSettingsPanel() {
  const userID = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: ['tickets', 'storage', userID],
    queryFn: getTicketStorage,
  })
  if (query.isPending) return <LoadingState size='sm' />
  if (query.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  return <TicketStorageForm settings={query.data} />
}

function TicketStorageForm(props: { settings: TicketStorageSettings }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [saved, setSaved] = useState(false)
  const form = useForm<StorageValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      notify_email: props.settings.notify_email,
      enabled: props.settings.enabled,
      retention_days: props.settings.retention_days,
      endpoint: props.settings.endpoint,
      bucket: props.settings.bucket,
      access_key: '',
      secret_key: '',
    },
  })
  const mutation = useMutation({
    mutationFn: () => saveTicketStorage(form.getValues()),
    onSuccess: (settings) => {
      form.reset({
        notify_email: settings.notify_email,
        enabled: settings.enabled,
        retention_days: settings.retention_days,
        endpoint: settings.endpoint,
        bucket: settings.bucket,
        access_key: '',
        secret_key: '',
      })
      setSaved(true)
      void client.invalidateQueries({ queryKey: ['status'] })
      void client.invalidateQueries({ queryKey: ['tickets', 'storage'] })
    },
    onError: (error) => handleServerError(error, t('Ticket operation failed')),
  })
  return (
    <Form {...form}>
      <form
        className='flex flex-col gap-4'
        onSubmit={form.handleSubmit((values) => {
          form.setValue('endpoint', values.endpoint)
          form.setValue('bucket', values.bucket)
          setSaved(false)
          mutation.mutate()
        })}
      >
        <Separator />
        <p className='font-medium'>{t('Email notifications')}</p>
        <FormField
          control={form.control}
          name='notify_email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Notification Email')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder='support@example.com'
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className='text-muted-foreground text-xs'>
          {t(
            'Send an email to this address when a user creates a ticket or replies. Leave empty to disable.'
          )}
        </p>
        <Separator />
        <FormField
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <SettingsSwitchField
              controlId='ticket-images-enabled'
              label={t('Allow ticket images')}
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={mutation.isPending}
            />
          )}
        />
        <p className='text-muted-foreground text-xs'>
          {t(
            'Use a private R2 bucket. Images expire independently of ticket messages and are cleaned up hourly.'
          )}
        </p>
        <FormField
          control={form.control}
          name='retention_days'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Image retention (days)')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  min={1}
                  max={365}
                  disabled={mutation.isPending}
                  onChange={(event) =>
                    field.onChange(Number(event.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <p className='text-muted-foreground text-xs'>
          {t(
            'Retention changes apply to new images. Existing expiry dates stay the same.'
          )}
        </p>
        <FormField
          control={form.control}
          name='endpoint'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('R2 S3 API endpoint')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder='https://<account-id>.r2.cloudflarestorage.com'
                  disabled={mutation.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='bucket'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('R2 bucket')}</FormLabel>
              <FormControl>
                <Input {...field} disabled={mutation.isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='access_key'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('R2 access key ID')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete='off'
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='secret_key'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('R2 secret access key')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoComplete='new-password'
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('Leave credential fields empty to keep saved credentials.')}
        </p>
        <p className='text-muted-foreground text-xs'>
          {props.settings.credentials_configured
            ? t('R2 credentials configured')
            : t('R2 credentials not configured')}
        </p>
        <div>
          <Button type='submit' disabled={mutation.isPending}>
            {t('Save Settings')}
          </Button>
        </div>
        {saved && !form.formState.isDirty && (
          <p role='status'>{t('Saved successfully')}</p>
        )}
      </form>
    </Form>
  )
}
