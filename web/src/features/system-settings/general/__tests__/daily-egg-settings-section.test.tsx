import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { DailyEggSettingsSection } from '../daily-egg-settings-section'

const initialSetting = JSON.stringify({
  enabled: false,
  min_spend_cny: 2.5,
  egg_count: 3,
  prizes: [
    { id: 'first', name: 'First', quota: 100, quantity: 10, probability: 2500 },
  ],
})

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <QueryClientProvider client={new QueryClient()}>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <DailyEggSettingsSection setting={initialSetting} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      usdExchangeRate: 5,
      customCurrencyExchangeRate: 2,
    },
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

it('uses the configured currency for both editable amounts and preserves their underlying units', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  render(<Fixture />)
  const minimum = screen.getByRole('spinbutton', {
    name: /Daily minimum spend/,
  })
  const reward = screen.getByRole('spinbutton', { name: /Reward quota/ })
  expect(minimum).toHaveValue(1)
  expect(reward).toHaveValue(0.0004)
  await user.clear(minimum)
  await user.type(minimum, '2')
  await user.clear(reward)
  await user.type(reward, '0.02')
  await user.click(
    screen.getByRole('button', { name: 'Save daily egg settings' })
  )
  await waitFor(() => expect(put).toHaveBeenCalled())
  const saved = JSON.parse((put.mock.calls[0][1] as { value: string }).value)
  expect(saved.min_spend_cny).toBe(5)
  expect(saved.prizes[0].quota).toBe(5000)
})

it('preserves existing amounts when other settings are saved', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  render(<Fixture />)
  await user.click(screen.getByRole('switch', { name: 'Enable daily egg' }))
  await user.click(
    screen.getByRole('button', { name: 'Save daily egg settings' })
  )
  await waitFor(() => expect(put).toHaveBeenCalled())
  const saved = JSON.parse((put.mock.calls[0][1] as { value: string }).value)
  expect(saved.min_spend_cny).toBe(2.5)
  expect(saved.prizes[0].quota).toBe(100)
})

it('updates displayed amounts when the currency configuration changes', () => {
  render(<Fixture />)
  act(() => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 5,
      },
    })
  })
  expect(
    screen.getByRole('spinbutton', { name: 'Daily minimum spend (CNY)' })
  ).toHaveValue(2.5)
  expect(
    screen.getByRole('spinbutton', { name: 'Reward quota (CNY)' })
  ).toHaveValue(0.001)
})

it('does not change a rounded display amount when its input is only focused', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      usdExchangeRate: 7.3,
      customCurrencyExchangeRate: 1,
    },
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  render(<Fixture />)
  await user.click(
    screen.getByRole('spinbutton', { name: /Daily minimum spend/ })
  )
  await user.click(
    screen.getByRole('button', { name: 'Save daily egg settings' })
  )
  await waitFor(() => expect(put).toHaveBeenCalled())
  const saved = JSON.parse((put.mock.calls[0][1] as { value: string }).value)
  expect(saved.min_spend_cny).toBe(2.5)
})

it('shows the effective threshold when currency conversion rounds to the nearest cent', async () => {
  const user = userEvent.setup()
  render(<Fixture />)
  const minimum = screen.getByRole('spinbutton', {
    name: /Daily minimum spend/,
  })
  await user.clear(minimum)
  await user.type(minimum, '0.003')
  expect(screen.getByText(/Effective minimum:/)).toHaveTextContent('🥚 0.004')
  await user.tab()
  expect(minimum).toHaveValue(0.004)
})

it('keeps prize fields in a responsive grid with an accessible remove button', () => {
  render(<Fixture />)
  const name = screen.getByRole('textbox', { name: 'Prize name' })
  const grid = name.closest('[data-slot="form-item"]')?.parentElement
  expect(grid).toHaveClass('sm:grid-cols-2', 'xl:grid-cols-4', 'items-start')
  expect(grid).toContainElement(
    screen.getByRole('spinbutton', { name: /Reward quota/ })
  )
  expect(grid?.parentElement).toContainElement(
    screen.getByRole('button', { name: 'Remove prize' })
  )
})

it('saves the minimum spend, egg count, prize quantity and probability', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 5,
    },
  })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  render(<Fixture />)
  await user.click(screen.getByRole('switch', { name: 'Enable daily egg' }))
  const minimum = screen.getByRole('spinbutton', {
    name: 'Daily minimum spend (CNY)',
  })
  await user.clear(minimum)
  await user.type(minimum, '3.25')
  const eggs = screen.getByRole('spinbutton', { name: 'Number of eggs' })
  await user.clear(eggs)
  await user.type(eggs, '4')
  const quantity = screen.getByRole('spinbutton', { name: 'Daily quantity' })
  await user.clear(quantity)
  await user.type(quantity, '20')
  const probability = screen.getByRole('spinbutton', {
    name: 'Probability (%)',
  })
  await user.clear(probability)
  await user.type(probability, '12.5')
  expect(minimum).toHaveValue(3.25)
  expect(eggs).toHaveValue(4)
  expect(quantity).toHaveValue(20)
  expect(probability).toHaveValue(12.5)
  await user.click(
    screen.getByRole('button', { name: 'Save daily egg settings' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'DailyEggSetting',
      value: JSON.stringify({
        enabled: true,
        min_spend_cny: 3.25,
        egg_count: 4,
        prizes: [
          {
            id: 'first',
            name: 'First',
            quota: 100,
            quantity: 20,
            probability: 1250,
          },
        ],
      }),
    })
  )
})

it('rejects prize probabilities above 100 percent', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  render(<Fixture />)
  await user.click(screen.getByRole('button', { name: 'Add prize' }))
  const name = screen.getAllByRole('textbox', { name: 'Prize name' })[1]
  await user.type(name, 'Second')
  const probabilities = screen.getAllByRole('spinbutton', {
    name: 'Probability (%)',
  })
  await user.clear(probabilities[1])
  await user.type(probabilities[1], '80')
  await user.click(
    screen.getByRole('button', { name: 'Save daily egg settings' })
  )
  expect(
    await screen.findByText('Prize probabilities cannot exceed 100%')
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})
