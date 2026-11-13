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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import type { UpdateOptionRequest } from '../../types'
import { BotProtectionSection } from '../bot-protection-section'

const defaults = {
  TurnstileCheckEnabled: false,
  TurnstileSiteKey: '',
  TurnstileSecretKey: '',
  turnstile: {
    login: true,
    register: true,
    email_verification: true,
    password_reset: true,
    checkin: true,
  },
}

let testI18n: i18n

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  )

  return (
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={client}>
        <div ref={setContainer} />
        <SettingsPageProvider actionsContainer={container}>
          <BotProtectionSection defaultValues={defaults} />
        </SettingsPageProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

async function renderSettings() {
  const route = createRootRoute({ component: Fixture })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

beforeEach(async () => {
  testI18n = createInstance()
  await testI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} }, zh },
    interpolation: { escapeValue: false },
  })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

describe('Bot Protection settings saves', () => {
  it('defaults every scene to enabled and saves independent choices without enabling the master switch', async () => {
    localStorage.setItem('status', '{}')
    await renderSettings()
    const user = userEvent.setup()
    for (const name of [
      'Password login',
      'Account registration',
      'Registration verification email',
      'Password reset email',
      'Daily Check-in',
    ]) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    }
    await user.click(screen.getByRole('switch', { name: 'Password login' }))
    await user.click(screen.getByRole('switch', { name: 'Daily Check-in' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    const put = vi.mocked(api.put)
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put.mock.calls.map(([, body]) => body)).toEqual([
      { key: 'turnstile.login', value: false },
      { key: 'turnstile.checkin', value: false },
    ])
    expect(
      screen.getByRole('switch', { name: 'Enable Turnstile' })
    ).toHaveAttribute('aria-checked', 'false')
    expect(localStorage.getItem('status')).toBeNull()
  })

  it('updates scene labels when the interface language changes', async () => {
    await renderSettings()
    await act(() => testI18n.changeLanguage('zh'))
    expect(screen.getByRole('switch', { name: '密码登录' })).toBeVisible()
    expect(screen.getByRole('switch', { name: '账号注册' })).toBeVisible()
    expect(screen.getByRole('switch', { name: '注册验证邮件' })).toBeVisible()
  })

  it('saves both keys before enabling Turnstile in one save', async () => {
    const savedOptions: Record<string, string | number | boolean> = {}
    const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
      const request = body as UpdateOptionRequest
      savedOptions[request.key] = request.value
      return { data: { success: true, message: '' } } as never
    })
    const user = userEvent.setup()
    await renderSettings()
    await user.type(
      screen.getByRole('textbox', { name: 'Site Key' }),
      'site-key'
    )
    await user.type(screen.getByLabelText('Secret Key'), 'secret-key')
    await user.click(screen.getByRole('switch', { name: 'Enable Turnstile' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(3))
    expect(
      put.mock.calls.map(([, body]) => (body as UpdateOptionRequest).key)
    ).toEqual([
      'TurnstileSiteKey',
      'TurnstileSecretKey',
      'TurnstileCheckEnabled',
    ])
    expect(savedOptions).toEqual({
      TurnstileSiteKey: 'site-key',
      TurnstileSecretKey: 'secret-key',
      TurnstileCheckEnabled: true,
    })
  })
})
