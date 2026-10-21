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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { EmailReminderState } from '../../types'
import { EmailBindingPrompt } from '../email-binding-prompt'

const navigate = vi.hoisted(() => vi.fn())
let pathname = '/'

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({
    select,
  }: {
    select: (location: { pathname: string }) => string
  }) => select({ pathname }),
  useNavigate: () => navigate,
}))

const promptState: EmailReminderState = {
  needs_binding: true,
  verified_emails: [],
  email_reminder_policy: 'normal',
  email_reminder_until: 0,
  should_prompt: true,
}

const queryClients: QueryClient[] = []

function renderPrompt() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailBindingPrompt />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  pathname = '/'
  navigate.mockReset()
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: promptState },
  })
})

afterEach(() => {
  for (const queryClient of queryClients) queryClient.clear()
  queryClients.length = 0
  vi.restoreAllMocks()
})

describe('email binding prompt', () => {
  it('offers binding and every reminder choice', async () => {
    renderPrompt()
    expect(
      await screen.findByRole('heading', {
        name: 'Bind your email to get usage notifications',
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bind now' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Do not remind me for 7 days' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Do not remind me today' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })

  it('navigates to the existing binding flow from Bind now', async () => {
    renderPrompt()
    fireEvent.click(await screen.findByRole('button', { name: 'Bind now' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/security' })
  })

  it('persists each reminder choice instead of only hiding the dialog', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...promptState,
          should_prompt: false,
          email_reminder_policy: 'off',
        },
      },
    })
    renderPrompt()
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/user/email_reminder', {
        action: 'off',
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', {
          name: 'Bind your email to get usage notifications',
        })
      ).toBeNull()
    )
  })

  it('treats closing the dialog as a today-only snooze', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: {
        success: true,
        data: {
          ...promptState,
          should_prompt: false,
          email_reminder_policy: 'snooze',
        },
      },
    })
    renderPrompt()
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/user/email_reminder', {
        action: 'snooze_today',
      })
    )
  })

  it('does not interrupt the security page where binding already happens', async () => {
    pathname = '/security'
    renderPrompt()
    await waitFor(() =>
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    )
    expect(api.get).not.toHaveBeenCalled()
  })
})
