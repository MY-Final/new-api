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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  SecureVerificationDialog,
  useSecureVerification,
} from '../secure-verification'

const requestSchema = z.object({
  device_name: z.string(),
  request_id: z.number().positive(),
  expires_at: z.number(),
  scopes: z.array(z.string()),
})

export function DesktopAuthorization(props: {
  flow: string
  onReturn?: (url: string) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const verification = useSecureVerification()
  const [pending, setPending] = useState(false)
  const [completed, setCompleted] = useState(false)
  const request = useQuery({
    queryKey: ['desktop-authorization', props.flow],
    retry: false,
    meta: { errorToast: false },
    queryFn: async ({ signal }) => {
      const response = await api.get('/api/desktop/auth/request', {
        params: { flow: props.flow },
        signal,
      })
      requireServerSuccess(response.data)
      return requestSchema.parse(response.data.data)
    },
  })

  async function decide(approve: boolean) {
    if (!request.data || pending) return
    setPending(true)
    try {
      const proof = approve
        ? await verification.requestVerification({
            scope: 'desktop.authorize',
            context: { request_id: request.data.request_id },
            title: t('Authorize KunCode Setup'),
          })
        : null
      if (approve && !proof) return
      const response = await api.post(
        '/api/desktop/auth/authorize',
        {
          flow: props.flow,
          approve,
        },
        {
          singleUseAuthorization: true,
          ...(proof
            ? { headers: { 'X-Security-Proof': proof.proof_token } }
            : {}),
        }
      )
      requireServerSuccess(response.data)
      const result = z
        .object({ callback_url: z.string().url() })
        .parse(response.data.data)
      const callback = new URL(result.callback_url)
      if (
        callback.protocol !== 'http:' ||
        callback.hostname !== '127.0.0.1' ||
        callback.pathname !== '/callback' ||
        !callback.port ||
        callback.username ||
        callback.password
      ) {
        throw new Error(t('Invalid desktop callback.'))
      }
      setCompleted(true)
      if (props.onReturn) props.onReturn(callback.href)
      else window.location.assign(callback.href)
    } catch (error) {
      handleServerError(
        error,
        t('Desktop authorization failed. Please try again.')
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className='mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-6 py-12'>
      <header className='space-y-2'>
        <p className='text-muted-foreground text-sm'>KunCode Setup</p>
        <h1 className='text-2xl font-semibold'>
          {t('Authorize KunCode Setup')}
        </h1>
      </header>
      {request.isPending && <LoadingState />}
      {request.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'This authorization request is invalid or expired. Start again in the desktop app.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {request.data && !completed && (
        <>
          <p>
            {t('Account')}: {user?.display_name || user?.username}
          </p>
          <p>
            {t('Device')}: {request.data.device_name}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Setup can read your profile and available models, manage your API keys, and configure only this desktop installation’s coding tools.'
            )}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Authorization lasts 30 days. Signing out of Setup keeps your configured tools available.'
            )}
          </p>
          <div className='flex gap-3'>
            <Button disabled={pending} onClick={() => void decide(true)}>
              {t('Authorize')}
            </Button>
            <Button
              variant='outline'
              disabled={pending}
              onClick={() => void decide(false)}
            >
              {t('Cancel')}
            </Button>
          </div>
        </>
      )}
      {completed && <p role='status'>{t('Returning to KunCode Setup…')}</p>}
      <SecureVerificationDialog {...verification.dialogProps} />
    </main>
  )
}

