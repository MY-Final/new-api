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

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { replyTicket } from '../api'
import { encodeScreenshots } from '../lib/screenshots'
import { ticketReplySchema, type TicketReplyValues } from '../lib/ticket-form'
import { ScreenshotsInput } from './screenshots-input'

export function TicketComposer(props: {
  id: number
  staff: boolean
  canReply: boolean
  canManage: boolean
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<TicketReplyValues>({
    resolver: zodResolver(ticketReplySchema),
    defaultValues: { content: '' },
  })
  const content = form.watch('content')
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState(false)
  const [generation, setGeneration] = useState(0)
  const attempt = useRef({ signature: '', key: crypto.randomUUID() })
  const mutation = useMutation({
    mutationFn: async (resolve: boolean) => {
      const screenshots = await encodeScreenshots(files)
      const signature = JSON.stringify({ content, screenshots, note, resolve })
      if (signature !== attempt.current.signature) {
        attempt.current = { signature, key: crypto.randomUUID() }
      }
      return replyTicket(
        props.staff,
        props.id,
        { content, screenshots, resolve, request_key: attempt.current.key },
        note
      )
    },
    onSuccess: () => {
      attempt.current = { signature: '', key: crypto.randomUUID() }
      form.reset()
      setFiles([])
      setGeneration((value) => value + 1)
      void client.invalidateQueries({ queryKey: ['tickets'] })
    },
    onError: (error) => handleServerError(error, t('Ticket operation failed')),
  })
  if (!props.canReply) return null
  return (
    <Form {...form}>
      <form
        className='space-y-3 border-t pt-4'
        onSubmit={form.handleSubmit(() => mutation.mutate(false))}
      >
        {props.staff && (
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              variant={note ? 'outline' : 'secondary'}
              aria-pressed={!note}
              disabled={mutation.isPending}
              onClick={() => setNote(false)}
            >
              {t('Reply to user')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant={note ? 'secondary' : 'outline'}
              aria-pressed={note}
              disabled={mutation.isPending}
              onClick={() => setNote(true)}
            >
              {t('Internal note')}
            </Button>
          </div>
        )}
        <FormField
          control={form.control}
          name='content'
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {note ? t('Only staff can see this note') : t('Reply')}
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  disabled={mutation.isPending}
                  maxLength={20000}
                  rows={4}
                  required
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <ScreenshotsInput
          key={generation}
          id='reply-screenshots'
          disabled={mutation.isPending}
          onChange={setFiles}
        />
        <div className='flex flex-wrap justify-end gap-2'>
          {props.staff && props.canManage && !note && (
            <Button
              type='button'
              variant='outline'
              disabled={mutation.isPending || !content.trim()}
              onClick={form.handleSubmit(() => mutation.mutate(true))}
            >
              {t('Reply and resolve')}
            </Button>
          )}
          <Button
            type='submit'
            disabled={mutation.isPending || !content.trim()}
          >
            {mutation.isPending ? t('Sending...') : t('Send')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
