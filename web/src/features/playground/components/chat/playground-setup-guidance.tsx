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
import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { getApiKeys } from '@/features/keys/api'
import { API_KEY_STATUS } from '@/features/keys/constants'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

export function PlaygroundSetupGuidance() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const userId = user?.id

  const keysQuery = useQuery({
    queryKey: ['playground', 'api-keys', userId],
    queryFn: async () => {
      const result = requireServerSuccess(await getApiKeys({ p: 1, size: 100 }))
      return result.data?.items ?? []
    },
    enabled: Boolean(userId),
    staleTime: 0,
  })

  const quota = user?.quota
  const hasNoUsableBalance =
    typeof quota === 'number' && Number.isFinite(quota) && quota <= 0
  const hasNoUsableApiKey =
    keysQuery.isSuccess &&
    !keysQuery.data.some((key) => key.status === API_KEY_STATUS.ENABLED)

  if (!hasNoUsableApiKey && !hasNoUsableBalance) return null

  return (
    <Alert className='text-left'>
      <AlertTriangle className='text-amber-600 dark:text-amber-400' />
      <AlertTitle>{t('Before you send')}</AlertTitle>
      <AlertDescription className='flex flex-col gap-3'>
        <div className='space-y-1'>
          {hasNoUsableApiKey && (
            <p>{t('Create or enable an API key before sending a request.')}</p>
          )}
          {hasNoUsableBalance && (
            <p>
              {t(
                'Your wallet balance is zero or negative. Add funds before sending a request.'
              )}
            </p>
          )}
        </div>
        <div className='flex flex-wrap gap-2'>
          {hasNoUsableApiKey && (
            <Button size='sm' variant='outline' render={<Link to='/keys' />}>
              {t('Go to API Keys')}
            </Button>
          )}
          {hasNoUsableBalance && (
            <Button size='sm' variant='outline' render={<Link to='/wallet' />}>
              {t('Add Funds')}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
