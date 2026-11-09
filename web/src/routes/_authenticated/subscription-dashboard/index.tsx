import { createFileRoute, redirect } from '@tanstack/react-router'

import { SubscriptionDashboard } from '@/features/subscription-dashboard'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/subscription-dashboard/')(
  {
    beforeLoad: () => {
      const { auth } = useAuthStore.getState()
      if (!auth.user || auth.user.role < ROLE.ADMIN) {
        throw redirect({ to: '/403' })
      }
    },
    component: SubscriptionDashboard,
  }
)
