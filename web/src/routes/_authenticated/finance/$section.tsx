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
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { Finance } from '@/features/finance'
import { ManualCreditWorkspace } from '@/features/finance/components/manual-credit-workspace'
import { RefundWorkspace } from '@/features/finance/components/refund-workspace'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const financeSearchSchema = z.object({
  request_id: z.string().max(64).optional().catch(undefined),
})

function FinanceRoute() {
  const { section } = Route.useParams()
  const { request_id } = Route.useSearch()
  if (section === 'credits') return <ManualCreditWorkspace />
  if (section === 'refunds') {
    return (
      <RefundWorkspace
        key={request_id || 'all'}
        initialRequestId={request_id}
      />
    )
  }
  return <Finance key={section} section={section} />
}

export const Route = createFileRoute('/_authenticated/finance/$section')({
  beforeLoad: ({ params }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
    if (
      ![
        'topups',
        'credits',
        'redemptions',
        'rebates',
        'operations',
        'refunds',
        'cash-refunds',
      ].includes(params.section)
    ) {
      throw redirect({ to: '/finance/$section', params: { section: 'topups' } })
    }
  },
  validateSearch: financeSearchSchema,
  component: FinanceRoute,
})
