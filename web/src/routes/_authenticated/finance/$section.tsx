import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { Finance } from '@/features/finance'
import { RefundWorkspace } from '@/features/finance/components/refund-workspace'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const financeSearchSchema = z.object({
  request_id: z.string().max(64).optional().catch(undefined),
})

function FinanceRoute() {
  const { section } = Route.useParams()
  const { request_id } = Route.useSearch()
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
