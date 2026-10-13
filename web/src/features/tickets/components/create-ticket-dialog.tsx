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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createTicket } from '../api'
import { ticketCategories } from '../constants'
import { encodeScreenshots } from '../lib/screenshots'
import { ticketSchema, type TicketFormValues } from '../lib/ticket-form'
import type { TicketCategory } from '../types'
import { ScreenshotsInput } from './screenshots-input'
import { TicketSelect } from './ticket-select'

export function CreateTicketDialog(props: {
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const attempt = useRef({ signature: '', key: crypto.randomUUID() })
  const [files, setFiles] = useState<File[]>([])
  const [occurredAt, setOccurredAt] = useState<Date>()
  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      title: '',
      category: 'api',
      content: '',
      request_id: '',
      order_number: '',
      model_name: '',
    },
  })
  const category = form.watch('category')
  const mutation = useMutation({
    mutationFn: async (values: TicketFormValues) => {
      const input = {
        ...values,
        request_id: values.category === 'api' ? values.request_id : '',
        model_name: values.category === 'api' ? values.model_name : '',
        order_number: values.category === 'payment' ? values.order_number : '',
      }
      const screenshots = await encodeScreenshots(files)
      const occurred_at = occurredAt
        ? Math.floor(occurredAt.getTime() / 1000)
        : 0
      const signature = JSON.stringify({ input, screenshots, occurred_at })
      if (signature !== attempt.current.signature) {
        attempt.current = { signature, key: crypto.randomUUID() }
      }
      return createTicket({
        ...input,
        occurred_at,
        request_key: attempt.current.key,
        screenshots,
      })
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['tickets'] })
      props.onCreated(result.id)
    },
    onError: (error) => handleServerError(error, t('Ticket operation failed')),
  })
  return (
    <Dialog
      open
      title={t('Submit ticket')}
      description={t(
        'Do not include passwords, full API keys, or verification codes. Redact sensitive information in screenshots.'
      )}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
    >
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        >
          <FormField
            control={form.control}
            name='category'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Category')}</FormLabel>
                <TicketSelect
                  label={t('Category')}
                  value={field.value}
                  options={ticketCategories}
                  onChange={(value) => field.onChange(value as TicketCategory)}
                  disabled={mutation.isPending}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Title')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    maxLength={160}
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Problem description')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={5}
                    maxLength={20000}
                    disabled={mutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {category === 'api' && (
            <div className='grid gap-4 sm:grid-cols-2'>
              <FormField
                control={form.control}
                name='request_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Request ID')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={128}
                        disabled={mutation.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='model_name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Model')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={128}
                        disabled={mutation.isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}
          {category === 'payment' && (
            <FormField
              control={form.control}
              name='order_number'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Order number')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={128}
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <div className='space-y-2'>
            <Label htmlFor='ticket-occurred-at'>
              {t('Time of occurrence')}
            </Label>
            <DateTimePicker
              id='ticket-occurred-at'
              value={occurredAt}
              disabled={mutation.isPending}
              onChange={setOccurredAt}
            />
          </div>
          <ScreenshotsInput
            id='create-screenshots'
            disabled={mutation.isPending}
            onChange={setFiles}
          />
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              disabled={mutation.isPending}
              onClick={props.onClose}
            >
              {t('Cancel')}
            </Button>
            <Button type='submit' disabled={mutation.isPending}>
              {mutation.isPending ? t('Submitting...') : t('Submit ticket')}
            </Button>
          </div>
        </form>
      </Form>
    </Dialog>
  )
}
