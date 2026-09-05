import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { Finance } from '@/features/finance'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const financeSearchSchema = z.object({}).catch({})

function FinanceRoute() {
  return <Finance section={Route.useParams().section} />
}

export const Route = createFileRoute('/_authenticated/finance/$section')({
  beforeLoad: ({ params }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) throw redirect({ to: '/403' })
    if (!['topups', 'redemptions', 'rebates', 'operations'].includes(params.section)) {
      throw redirect({ to: '/finance/$section', params: { section: 'topups' } })
    }
  },
  validateSearch: financeSearchSchema,
  component: FinanceRoute,
})
