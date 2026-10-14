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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { buttonVariants } from '@/components/ui/button'
import { formatQuotaPrecise } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { StatCard } from '../ui/stat-card'

export function PersonalBalanceCard() {
  const { t } = useTranslation()
  const quota = useAuthStore((state) => state.auth.user?.quota)
  useSystemConfigStore((state) => state.config.currency)
  const balance = quota == null ? Number.NaN : Number(quota)
  const hasDebt = balance < 0
  const title = hasDebt ? t('Debt') : t('Current Balance')

  return (
    <section
      aria-label={title}
      className={cn(
        'bg-primary/5 border-primary/20 min-w-0 rounded-xl border p-3 sm:p-4',
        hasDebt && 'border-destructive/30 bg-destructive/5'
      )}
    >
      <StatCard
        title={title}
        value={formatQuotaPrecise(Math.abs(balance))}
        description={
          hasDebt
            ? t('Recharge to settle debt')
            : t('Current balance, independent of the selected period')
        }
        descriptionClassName='line-clamp-none'
        icon={WalletCards}
        iconTone={hasDebt ? 'destructive' : 'success'}
        error={!Number.isFinite(balance)}
        action={
          <Link
            to='/wallet'
            aria-label={t('Go to Wallet')}
            title={t('Go to Wallet')}
            className={buttonVariants({ variant: 'ghost', size: 'icon-xs' })}
          >
            <ArrowUpRight aria-hidden='true' />
          </Link>
        }
      />
    </section>
  )
}
