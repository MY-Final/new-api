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
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { ApiKeyGroupCell } = await import('../api-key-group-cell')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        Auto: 'Auto',
        'Cross-group': 'Cross-group',
        'Change group': 'Change group',
        'Follow user group': 'Follow user group',
        'Group updated': 'Group updated',
        'Failed to update group': 'Failed to update group',
        'No group found.': 'No group found.',
        Ratio: 'Ratio',
        'Search...': 'Search...',
        'Automatically selects the best available group with circuit breaker mechanism':
          'Automatically selects the best available group with circuit breaker mechanism',
      },
    },
  },
})

const groupOptions = [
  { value: 'default', label: 'default', desc: 'User group', ratio: 1 },
  { value: 'vip', label: 'vip', desc: 'Priority group', ratio: 3 },
  { value: 'auto', label: 'auto', desc: 'Automatic routing', ratio: '自动' },
]

function renderCell(props: {
  group: string
  ratio?: number | string
  crossGroupRetry?: boolean
  shouldReduceMotion?: boolean
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ApiKeyGroupCell
          apiKeyId={7}
          options={groupOptions}
          group={props.group}
          ratio={props.ratio}
          crossGroupRetry={props.crossGroupRetry ?? false}
          shouldReduceMotion={props.shouldReduceMotion ?? false}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

function getCommandItem(label: string): HTMLElement {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ].find((candidate) => candidate.textContent?.includes(label))
  if (!item) {
    throw new Error(`Expected a command item containing "${label}"`)
  }
  return item
}

describe('API key group table cell', () => {
  test('keeps the group and compact localized multiplier together with one subtle flowing edge', () => {
    const { container } = renderCell({
      group: 'auto',
      ratio: '自动',
      crossGroupRetry: true,
    })
    const group = screen.getByText('Cross-group')
    const multiplier = screen
      .getByText('Auto')
      .closest<HTMLElement>('[data-slot="badge"]')
    expect(group).toBeInTheDocument()
    expect(multiplier).toHaveClass('h-5', 'min-w-12', 'rounded-md')
    expect(multiplier).not.toHaveTextContent('Ratio')
    expect(container).not.toHaveTextContent('自动')
    expect(container.querySelector('[data-auto-group-frame]')).toBeNull()
    const flow = container.querySelector('[data-auto-group-flow-border]')
    expect(flow).toHaveClass('auto-group-flow-border-subtle')
    expect(flow).toHaveAttribute('aria-hidden', 'true')
    expect(group.closest('[data-api-key-group-cell]')).toContainElement(
      multiplier
    )
  })

  test('keeps the automatic tag visible but static when reduced motion is requested', () => {
    const { container } = renderCell({
      group: 'auto',
      ratio: 'Auto',
      shouldReduceMotion: true,
    })
    expect(screen.getByText('Auto')).toBeInTheDocument()
    expect(container.querySelector('[data-auto-group-flow-border]')).toBeNull()
  })

  test('does not invent a multiplier while automatic ratio data is unavailable', () => {
    renderCell({ group: 'auto' })
    expect(screen.getByText('Cross-group')).toBeInTheDocument()
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
  })

  test.each([
    [0.8, 'bg-info/10', 'text-info', 'border-info/30'],
    [1, 'bg-muted', 'text-muted-foreground', 'border-muted-foreground/30'],
    [3, 'bg-warning/10', 'text-warning', 'border-warning/30'],
  ])(
    'preserves the original %s multiplier color in the compact layout',
    (ratio, background, color, border) => {
      const { container } = renderCell({ group: 'default', ratio })
      const multiplier = screen.getByText(`${ratio}x`).parentElement
      expect(multiplier).toHaveClass(
        background,
        color,
        border,
        'rounded-full',
        'tabular-nums',
        'h-5',
        'min-w-12'
      )
      expect(
        container.querySelector('[data-auto-group-flow-border]')
      ).toBeNull()
    }
  )

  test('labels the user group multiplier as inherited without inventing a numeric value', () => {
    renderCell({ group: '' })
    expect(screen.getByText('User Group')).toBeInTheDocument()
    expect(screen.getByText('Inherited')).toBeInTheDocument()
    expect(screen.getByText('Inherited').parentElement).toHaveClass(
      'border-muted-foreground/30',
      'rounded-full'
    )
    expect(screen.queryByText('1x')).not.toBeInTheDocument()
    // The switch affordance replaces the old read-only tooltip; the full
    // fallback name stays reachable without hover.
    expect(
      screen.getByRole('button', { name: 'Change group' })
    ).toHaveAttribute('title', 'Follow user group')
  })

  test('keeps a long group name reachable through the switch trigger', async () => {
    const groupName = 'production-with-a-very-long-custom-group-name'
    renderCell({ group: groupName, ratio: 12.345678 })
    const trigger = screen.getByRole('button', { name: 'Change group' })
    expect(trigger).toHaveClass('max-w-50')
    expect(trigger).toHaveAttribute('title', groupName)
    expect(screen.getByText('12.345678x')).toBeInTheDocument()

    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(getCommandItem('Priority group')).toBeInTheDocument()
  })

  test('never turns a string-valued normal group ratio into an automatic multiplier', () => {
    renderCell({ group: 'vip', ratio: '自动' })
    expect(screen.getByText('vip')).toBeInTheDocument()
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
    expect(screen.queryByText('自动')).not.toBeInTheDocument()
  })

  test('switches the group inline through the group-only update', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    renderCell({ group: 'vip', ratio: 3 })

    await userEvent.click(screen.getByRole('button', { name: 'Change group' }))
    fireEvent.click(getCommandItem('User group'))

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/token/?group_only=true', {
        id: 7,
        group: 'default',
      })
    )
    put.mockRestore()
  })

  test('does not write when the selected group is the current one', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    renderCell({ group: 'vip', ratio: 3 })

    await userEvent.click(screen.getByRole('button', { name: 'Change group' }))
    fireEvent.click(getCommandItem('Priority group'))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Change group' })
      ).toHaveAttribute('aria-expanded', 'false')
    )
    expect(put).not.toHaveBeenCalled()
    put.mockRestore()
  })
})
