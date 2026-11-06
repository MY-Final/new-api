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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  ApiKeyGroupCombobox,
  type ApiKeyGroupOption,
} from '@/features/keys/components/api-key-group-combobox'
import { api, getUserGroups } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import {
  requireServerSuccess,
  translateServerText,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  SecureVerificationDialog,
  useSecureVerification,
} from '../secure-verification'

const requestSchema = z.object({
  client_id: z.enum(['kuncode-setup', 'magpie']).default('kuncode-setup'),
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
  const [selectedGroup, setSelectedGroup] = useState('')
  const request = useQuery({
    queryKey: ['desktop-authorization', props.flow],
    retry: false,
    meta: { errorToast: false },
    queryFn: async ({ signal }) => {
      const response = await api.get('/api/desktop/auth/request', {
        params: { flow: props.flow },
        signal,
        disableDuplicate: true,
      })
      requireServerSuccess(response.data)
      return requestSchema.parse(response.data.data)
    },
  })
  const isMagpie = request.data?.client_id === 'magpie'
  const groups = useQuery({
    queryKey: ['desktop-authorization-groups'],
    queryFn: async () =>
      requireServerSuccess(
        await getUserGroups({
          disableDuplicate: true,
        })
      ),
    enabled: isMagpie,
    retry: false,
    meta: { errorToast: false },
    staleTime: 0,
  })
  const groupOptions = useMemo<ApiKeyGroupOption[]>(() => {
    const options = Object.entries(groups.data?.data || {})
      .filter(([value]) => value !== 'auto')
      .map(([value, info]) => ({
        value,
        label: value,
        desc: info.desc ? translateServerText(t, info.desc) : undefined,
        ratio: info.ratio,
      }))
    return options.sort((left, right) => {
      if (left.value === user?.group) return -1
      if (right.value === user?.group) return 1
      return left.value.localeCompare(right.value)
    })
  }, [groups.data, t, user?.group])
  useEffect(() => {
    if (!isMagpie || groupOptions.length === 0) return
    if (groupOptions.some((group) => group.value === selectedGroup)) return
    const defaultGroup =
      groupOptions.find((group) => group.value === user?.group)?.value ||
      groupOptions[0].value
    setSelectedGroup(defaultGroup)
  }, [groupOptions, isMagpie, selectedGroup, user?.group])
  const authorizationTitle = isMagpie
    ? t('Authorize Magpie')
    : t('Authorize KunCode Setup')
  const groupUnavailable =
    isMagpie &&
    (groups.isPending ||
      groups.isError ||
      groupOptions.length === 0 ||
      !selectedGroup)

  async function decide(approve: boolean) {
    if (!request.data || pending) return
    if (approve && isMagpie && !selectedGroup) return
    setPending(true)
    try {
      const proof = approve
        ? await verification.requestVerification({
            scope: 'desktop.authorize',
            context: {
              request_id: request.data.request_id,
              ...(isMagpie ? { group: selectedGroup } : {}),
            },
            title: authorizationTitle,
          })
        : null
      if (approve && !proof) return
      const response = await api.post(
        '/api/desktop/auth/authorize',
        {
          flow: props.flow,
          approve,
          ...(isMagpie ? { group: selectedGroup } : {}),
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
        throw new Error(t('Invalid authorization callback.'))
      }
      setCompleted(true)
      if (props.onReturn) props.onReturn(callback.href)
      else window.location.assign(callback.href)
    } catch (error) {
      handleServerError(
        error,
        isMagpie
          ? t('Magpie authorization failed. Please try again.')
          : t('Desktop authorization failed. Please try again.')
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <main className='mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-6 px-6 py-12'>
      <header className='space-y-2'>
        <p className='text-muted-foreground text-sm'>
          {isMagpie ? 'Magpie' : 'KunCode Setup'}
        </p>
        <h1 className='text-2xl font-semibold'>{authorizationTitle}</h1>
      </header>
      {request.isPending && <LoadingState />}
      {request.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'This authorization request is invalid or expired. Start again in the requesting app.'
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
            {isMagpie
              ? t(
                  'Magpie can read your profile and wallet balance, and perform your daily check-in. It cannot change your account or model keys.'
                )
              : t(
                  'Setup can read your profile and available models, manage your API keys, and configure only this desktop installation’s coding tools.'
                )}
          </p>
          <p className='text-muted-foreground text-sm'>
            {isMagpie
              ? t(
                  'Authorization lasts 30 days. You can revoke the Magpie credentials from access token security settings.'
                )
              : t(
                  'Authorization lasts 30 days. Signing out of Setup keeps your configured tools available.'
                )}
          </p>
          {isMagpie && groups.isPending && (
            <p className='text-muted-foreground text-sm'>{t('Loading')}</p>
          )}
          {isMagpie && groups.isError && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('Failed to load groups. Try again.')}
              </AlertDescription>
            </Alert>
          )}
          {isMagpie && groups.isSuccess && groupOptions.length === 0 && (
            <Alert variant='destructive'>
              <AlertDescription>{t('No group found.')}</AlertDescription>
            </Alert>
          )}
          {isMagpie && groupOptions.length > 0 && (
            <div className='space-y-2'>
              <Label htmlFor='magpie-key-group' required>
                {t('Group')}
              </Label>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Choose the model group this Magpie key will use. Reauthorize to change it.'
                )}
              </p>
              <ApiKeyGroupCombobox
                id='magpie-key-group'
                ariaLabel={t('Group')}
                options={groupOptions}
                value={selectedGroup}
                onValueChange={setSelectedGroup}
                disabled={pending}
              />
            </div>
          )}
          <div className='flex gap-3'>
            <Button
              disabled={pending || groupUnavailable}
              onClick={() => void decide(true)}
            >
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
      {completed && (
        <p role='status'>
          {isMagpie
            ? t('Returning to Magpie…')
            : t('Returning to KunCode Setup…')}
        </p>
      )}
      <SecureVerificationDialog {...verification.dialogProps} />
    </main>
  )
}
