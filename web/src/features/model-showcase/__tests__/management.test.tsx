import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { ShowcasePlanForm } from '../components/showcase-plan-form'
import type { ShowcasePlan } from '../types'

const plan: ShowcasePlan = {
  id: 5,
  name: 'Pelican test',
  group: 'public',
  model: 'model-a',
  prompt: 'Draw a pelican',
  interval_minutes: 60,
  keep_count: 24,
  max_output_tokens: 9216,
  timeout_seconds: 1800,
  enabled: false,
  public: true,
  sort_order: 0,
  next_run_at: 0,
  run_requested: false,
}
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/group/' ? ['public', 'premium'] : ['model-a', 'model-b'],
    },
  }))
})

afterEach(() => client.clear())

test('new plans start paused with public results and bounded execution defaults', () => {
  render(
    <QueryClientProvider client={client}>
      <ShowcasePlanForm plan={null} onSaved={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>
  )
  expect(
    screen.getByRole('switch', { name: 'Enable scheduled tests' })
  ).not.toBeChecked()
  expect(screen.getByRole('switch', { name: 'Show publicly' })).toBeChecked()
  expect(
    screen.getByRole('spinbutton', { name: 'Test interval (minutes)' })
  ).toHaveValue(60)
  expect(
    screen.getByRole('spinbutton', { name: 'Keep recent results' })
  ).toHaveValue(24)
  expect(
    screen.getByRole('spinbutton', { name: 'Maximum output tokens' })
  ).toHaveAttribute('max', '32768')
})

test('saving an edited plan preserves the selected group and submits execution settings', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  const saved = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ShowcasePlanForm plan={plan} onSaved={saved} onCancel={vi.fn()} />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.clear(
    screen.getByRole('spinbutton', { name: 'Keep recent results' })
  )
  await user.type(
    screen.getByRole('spinbutton', { name: 'Keep recent results' }),
    '12'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(post).toHaveBeenCalledWith(
    '/api/showcase/admin/plans',
    expect.objectContaining({
      id: 5,
      group: 'public',
      model: 'model-a',
      keep_count: 12,
      enabled: false,
      public: true,
    })
  )
})

test('changing the test group clears the previous model selection', async () => {
  render(
    <QueryClientProvider client={client}>
      <ShowcasePlanForm plan={plan} onSaved={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>
  )
  const group = screen.getByRole('combobox', { name: 'Group Name' })
  await waitFor(() => expect(group).toBeEnabled())
  const field = group.closest('[data-slot="form-item"]')
  expect(field).not.toBeNull()
  await userEvent.click(
    within(field as HTMLElement).getByRole('button', { name: 'Open' })
  )
  await userEvent.click(await screen.findByRole('option', { name: 'premium' }))
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('')
})

test('invalid numeric limits prevent saving the test plan', async () => {
  const post = vi.spyOn(api, 'post')
  render(
    <QueryClientProvider client={client}>
      <ShowcasePlanForm plan={plan} onSaved={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.clear(
    screen.getByRole('spinbutton', { name: 'Maximum output tokens' })
  )
  await user.type(
    screen.getByRole('spinbutton', { name: 'Maximum output tokens' }),
    '-1'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(post).not.toHaveBeenCalled()
})

test('a rejected save leaves the form open and does not report success', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: 'Plan save failed' },
  })
  const saved = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ShowcasePlanForm plan={plan} onSaved={saved} onCancel={vi.fn()} />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  )
  expect(saved).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Pelican test'
  )
})
