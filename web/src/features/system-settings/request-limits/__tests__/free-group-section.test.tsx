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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { FreeGroupSection } from '../free-group-section'

function Fixture(props: { groupRatio: string; setting: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <FreeGroupSection
          setting={props.setting}
          used={3}
          groupRatio={props.groupRatio}
        />
      </SettingsPageProvider>
    </>
  )
}

test('saves the free group limits and displays today’s usage', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Fixture
        setting='{"enabled":false,"group":"","daily_limit":10000,"user_limit":0}'
        groupRatio='{"free":1,"premium":2,"auto":1}'
      />
    </QueryClientProvider>
  )
  expect(screen.getByText(/Used today: 3/)).toHaveTextContent(
    'Remaining today: 9,997'
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('switch', { name: 'Enable free group' }))
  const group = screen.getByRole('combobox', { name: 'Group Name' })
  expect(group.tagName).toBe('INPUT')
  expect(group.closest('[data-slot="input-group"]')).toHaveClass('min-h-8')
  expect(group.closest('[data-slot="form-item"]')?.parentElement).toHaveClass(
    'items-start'
  )
  await user.click(screen.getByRole('button', { name: 'Open' }))
  expect(await screen.findByRole('option', { name: 'premium' })).toBeVisible()
  expect(screen.queryByRole('option', { name: 'auto' })).not.toBeInTheDocument()
  await user.type(group, 'fre')
  expect(
    screen.queryByRole('option', { name: 'premium' })
  ).not.toBeInTheDocument()
  await user.click(await screen.findByRole('option', { name: 'free' }))
  await user.clear(
    screen.getByRole('spinbutton', { name: 'Daily limit per user' })
  )
  await user.type(
    screen.getByRole('spinbutton', { name: 'Daily limit per user' }),
    '10'
  )
  await user.click(
    screen.getByRole('button', { name: 'Save free group settings' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'FreeGroupSetting',
      value:
        '{"enabled":true,"group":"free","daily_limit":10000,"user_limit":10}',
    })
  )
})

test('typing an unknown group cannot save it as a selection', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Fixture
        setting='{"enabled":false,"group":"","daily_limit":10000,"user_limit":0}'
        groupRatio='{"free":1}'
      />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('switch', { name: 'Enable free group' }))
  await user.type(
    screen.getByRole('combobox', { name: 'Group Name' }),
    'missing'
  )
  await user.keyboard('{Escape}')
  await user.click(
    screen.getByRole('button', { name: 'Save free group settings' })
  )
  expect(
    await screen.findByText('Choose an existing group', {
      selector: '[data-slot="form-message"]',
    })
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})

test('an empty group list disables selection and cannot enable a group', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Fixture
        setting='{"enabled":false,"group":"","daily_limit":10000,"user_limit":0}'
        groupRatio='{}'
      />
    </QueryClientProvider>
  )
  expect(screen.getByRole('combobox', { name: 'Group Name' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: 'Group Name' })).toHaveAttribute(
    'placeholder',
    'No group found.'
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('switch', { name: 'Enable free group' }))
  await user.click(
    screen.getByRole('button', { name: 'Save free group settings' })
  )
  expect(
    await screen.findByText('Choose an existing group', {
      selector: '[data-slot="form-message"]',
    })
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})

test('a deleted saved group must be replaced before saving an enabled configuration', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Fixture
        setting='{"enabled":true,"group":"deleted","daily_limit":10000,"user_limit":0}'
        groupRatio='{"free":1}'
      />
    </QueryClientProvider>
  )
  const select = screen.getByRole('combobox', { name: 'Group Name' })
  expect(select).toHaveValue('deleted')
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'Save free group settings' })
  )
  expect(
    await screen.findByText('Choose an existing group', {
      selector: '[data-slot="form-message"]',
    })
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  select.focus()
  await user.keyboard('{ArrowDown}')
  await user.keyboard('{Enter}')
  expect(select).toHaveValue('free')
  await user.click(
    screen.getByRole('button', { name: 'Save free group settings' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'FreeGroupSetting',
      value:
        '{"enabled":true,"group":"free","daily_limit":10000,"user_limit":0}',
    })
  )
})
