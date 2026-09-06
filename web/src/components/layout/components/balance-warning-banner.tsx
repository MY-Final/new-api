/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DEFAULT_QUOTA_WARNING_THRESHOLD } from '@/features/profile/constants'
import { parseUserSettings } from '@/features/profile/lib'
import { getSelf } from '@/lib/api'
import { formatQuotaPrecise } from '@/lib/format'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

export function BalanceWarningBanner() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const setUser = useAuthStore((state) => state.auth.setUser)

  useQuery({
    queryKey: ['user', 'self', user?.id],
    queryFn: async () => {
      const requestedUser = useAuthStore.getState().auth.user
      const response = await getSelf()
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load user data')
      }

      const nextUser = response.data as AuthUser
      const currentUser = useAuthStore.getState().auth.user
      if (
        requestedUser &&
        currentUser === requestedUser &&
        currentUser.id === nextUser.id
      ) {
        setUser(nextUser)
      }
      return nextUser
    },
    enabled: Boolean(user),
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  })

  const currentUser = user
  if (!currentUser) return null

  const quota = Number(currentUser.quota)
  if (!Number.isFinite(quota)) return null

  const settings = parseUserSettings(currentUser.setting)
  const configuredThreshold = Number(settings.quota_warning_threshold)
  const threshold =
    Number.isFinite(configuredThreshold) && configuredThreshold > 0
      ? configuredThreshold
      : DEFAULT_QUOTA_WARNING_THRESHOLD

  if (quota > threshold) return null

  return (
    <div className='shrink-0 px-3 pt-2 sm:px-4'>
      <Alert className='border-amber-500/40 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100'>
        <AlertTriangle aria-hidden='true' />
        <AlertTitle>{t('Low balance')}</AlertTitle>
        <AlertDescription className='flex flex-wrap items-center gap-x-3 gap-y-2'>
          <span>
            {t('Your balance is below the warning threshold')}{' '}
            {t('Current balance: {{value}}', {
              value: formatQuotaPrecise(quota),
            })}
          </span>
          <Button
            size='sm'
            render={<Link to='/wallet' />}
            className='h-7 bg-amber-600 px-2.5 text-xs text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400'
          >
            {t('Go to Wallet')}
            <ArrowUpRight className='size-3.5' aria-hidden='true' />
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
