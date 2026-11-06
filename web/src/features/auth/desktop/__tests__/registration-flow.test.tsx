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
import { isRedirect } from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route as DesktopAuthorizeRoute } from '@/routes/(auth)/desktop/authorize'
import { useAuthStore } from '@/stores/auth-store'

vi.mock('@/lib/auth-session', () => ({
  resolveAuthentication: vi.fn().mockResolvedValue(undefined),
}))

describe('desktop registration flow', () => {
  beforeEach(() => {
    useAuthStore.getState().auth.reset('complete')
  })

  it('opens Magpie sign-up with the invite code and keeps the desktop flow as its return target', async () => {
    const flow = 'f'.repeat(43)
    const inviteCode = 'shjglbwadfbhblqvwcpqoqbo'
    const href = `/desktop/authorize?flow=${flow}&mode=register&invite_code=${inviteCode}`
    let redirectError: unknown

    try {
      const beforeLoad = DesktopAuthorizeRoute.options
        .beforeLoad as unknown as (context: {
        location: { href: string }
        search: { mode: 'register'; invite_code: string }
      }) => Promise<void>
      await beforeLoad({
        location: { href },
        search: { mode: 'register', invite_code: inviteCode },
      })
    } catch (error) {
      redirectError = error
    }

    if (!isRedirect(redirectError)) {
      throw new Error('desktop registration did not redirect to sign-up')
    }
    expect(redirectError.options.to).toBe('/sign-up')
    expect(redirectError.options.search).toEqual({
      invite_code: inviteCode,
      redirect: href,
    })
  })
})
