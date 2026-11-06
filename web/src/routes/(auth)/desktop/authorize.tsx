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
import { z } from 'zod'

import { DesktopAuthorization } from '@/features/auth/desktop/authorization'
import { sanitizeAuthRedirect } from '@/features/auth/lib/auth-redirect'
import { resolveAuthentication } from '@/lib/auth-session'
import { useAuthStore } from '@/stores/auth-store'

const searchSchema = z.object({
  flow: z.string().min(43).max(128),
  mode: z.literal('register').optional(),
  invite_code: z.string().trim().max(64).optional(),
})

export const Route = createFileRoute('/(auth)/desktop/authorize')({
  validateSearch: searchSchema,
  beforeLoad: async ({ location, search }) => {
    await resolveAuthentication()
    if (!useAuthStore.getState().auth.user) {
      const redirectTarget =
        sanitizeAuthRedirect(location.href, window.location.origin) ?? undefined
      if (search.mode === 'register') {
        throw redirect({
          to: '/sign-up',
          search: {
            invite_code: search.invite_code,
            redirect: redirectTarget,
          },
          replace: true,
        })
      }
      throw redirect({
        to: '/sign-in',
        search: { redirect: redirectTarget },
        replace: true,
      })
    }
  },
  component: DesktopAuthorizeRoute,
})

function DesktopAuthorizeRoute() {
  const search = Route.useSearch()
  return <DesktopAuthorization flow={search.flow} />
}
