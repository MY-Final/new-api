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
import { AlertTriangle, Clock3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { useBillingHistory } from '../hooks/use-billing-history'
import type { BillingRecord } from '../types'

function isActionableTopup(record: BillingRecord): boolean {
  if (record.record_type !== 'topup') {
    return false
  }

  return (
    record.status === 'pending' ||
    record.status === 'failed' ||
    record.status === 'expired'
  )
}

interface PaymentRecoveryNoticeProps {
  onViewHistory: () => void
  onStartTopup: () => void
}

export function PaymentRecoveryNotice({
  onViewHistory,
  onStartTopup,
}: PaymentRecoveryNoticeProps) {
  const { t } = useTranslation()
  const { records, loading } = useBillingHistory({ initialPageSize: 100 })

  if (loading) {
    return null
  }

  const actionableRecords = records.filter(isActionableTopup)
  if (actionableRecords.length === 0) {
    return null
  }

  const hasPending = actionableRecords.some(
    (record) => record.status === 'pending'
  )
  const hasFailed = actionableRecords.some(
    (record) => record.status === 'failed' || record.status === 'expired'
  )
  const hasMixedRecovery = hasPending && hasFailed

  let description = t('Check order history before trying again.')
  if (hasMixedRecovery || hasFailed) {
    description = t('Check order history or try again from Add Funds.')
  }

  return (
    <Alert
      className={
        hasPending && !hasFailed
          ? 'border-warning/40 bg-warning/5'
          : 'border-destructive/40 bg-destructive/5'
      }
    >
      {hasPending && !hasFailed ? (
        <Clock3 aria-hidden='true' />
      ) : (
        <AlertTriangle aria-hidden='true' />
      )}
      <AlertTitle>
        {hasPending && !hasFailed
          ? t('Payment pending')
          : t('Payment needs attention')}
      </AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <AlertAction>
        <span className='flex flex-wrap items-center justify-end gap-2'>
          <Button size='sm' variant='outline' onClick={onViewHistory}>
            {t('Order History')}
          </Button>
          {hasFailed && (
            <Button size='sm' onClick={onStartTopup}>
              {t('Add Funds')}
            </Button>
          )}
        </span>
      </AlertAction>
    </Alert>
  )
}
