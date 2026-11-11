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
import { CircleCheck, CircleSlash } from 'lucide-react'
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
import { useSystemConfig } from '@/hooks/use-system-config'
import { api, getUserGroups } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import {
  requireServerSuccess,
  translateServerText,
} from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
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

// 成功页停留一会再回跳，让用户看清楚结果；手动点按钮可以立刻回去。
const RETURN_DELAY_MS = 1500

type AuthorizationOutcome = {
  approved: boolean
  href: string
}

export function DesktopAuthorization(props: {
  flow: string
  onReturn?: (url: string) => void
}) {
  const { t } = useTranslation()
  const { systemName, logo } = useSystemConfig()
  const user = useAuthStore((state) => state.auth.user)
  const verification = useSecureVerification()
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<AuthorizationOutcome | null>(null)
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
  const returnHref = outcome?.href
  const onReturn = props.onReturn
  useEffect(() => {
    if (!returnHref) return
    const timer = window.setTimeout(() => {
      if (onReturn) onReturn(returnHref)
      else window.location.assign(returnHref)
    }, RETURN_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [returnHref, onReturn])
  const authorizationTitle = isMagpie
    ? t('Authorize Magpie')
    : t('Authorize KunCode Setup')
  let outcomeSubtitle = ''
  if (outcome?.approved) {
    outcomeSubtitle = isMagpie
      ? t('Returning to Magpie…')
      : t('Returning to KunCode Setup…')
  } else if (outcome) {
    outcomeSubtitle = t('Nothing was shared. You can close this page.')
  }
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
      setOutcome({ approved: approve, href: callback.href })
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
    <main className='mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-8 px-6 py-12'>
      <div className='flex items-center gap-2.5'>
        <img
          src={logo}
          alt={t('Logo')}
          className='size-8 rounded-full object-cover'
        />
        <span className='text-lg font-medium'>{systemName}</span>
      </div>
      {outcome ? (
        <section
          role='status'
          aria-live='polite'
          className='flex flex-col items-center gap-5 py-6 text-center'
        >
          <span
            className={cn(
              'flex size-16 items-center justify-center rounded-full',
              outcome.approved
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {outcome.approved ? (
              <CircleCheck className='size-9' aria-hidden='true' />
            ) : (
              <CircleSlash className='size-9' aria-hidden='true' />
            )}
          </span>
          <div className='space-y-2'>
            <h1 className='text-xl font-semibold tracking-tight'>
              {outcome.approved
                ? t('Authorization complete')
                : t('Authorization cancelled')}
            </h1>
            <p className='text-muted-foreground text-sm'>{outcomeSubtitle}</p>
            {outcome.approved && isMagpie && selectedGroup && (
              <p className='text-muted-foreground text-sm'>
                {t('Group')}:{' '}
                <span className='text-foreground font-medium'>
                  {selectedGroup}
                </span>
              </p>
            )}
          </div>
          <Button variant='outline' render={<a href={outcome.href} />}>
            {t('Return now')}
          </Button>
          <p className='text-muted-foreground text-xs'>
            {t('If the app did not open automatically, use the button above.')}
          </p>
        </section>
      ) : null}
      {!outcome && request.isPending && <LoadingState />}
      {request.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'This authorization request is invalid or expired. Start again in the requesting app.'
            )}
          </AlertDescription>
        </Alert>
      )}
      {request.data && !outcome && (
        <div className='space-y-6'>
          <header className='space-y-2'>
            <p className='text-muted-foreground text-sm'>
              {isMagpie ? 'Magpie' : 'KunCode Setup'}
            </p>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {authorizationTitle}
            </h1>
          </header>
          <dl className='bg-muted/40 divide-border divide-y rounded-xl border text-sm'>
            <div className='flex items-baseline justify-between gap-4 px-4 py-2.5'>
              <dt className='text-muted-foreground'>{t('Account')}</dt>
              <dd className='font-medium'>
                {user?.display_name || user?.username}
              </dd>
            </div>
            <div className='flex items-baseline justify-between gap-4 px-4 py-2.5'>
              <dt className='text-muted-foreground'>{t('Device')}</dt>
              <dd className='font-medium'>{request.data.device_name}</dd>
            </div>
          </dl>
          <p className='text-muted-foreground text-sm'>
            {isMagpie
              ? t(
                  'Magpie can read your profile, wallet balance, and subscription usage, and perform your daily check-in. It cannot change your account or model keys.'
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
        </div>
      )}
      <SecureVerificationDialog {...verification.dialogProps} />
    </main>
  )
}
