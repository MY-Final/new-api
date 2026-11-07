import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { formatQuota } from '@/lib/format'

import { UserBusinessOverview } from '../user-business-overview'

const mocks = vi.hoisted(() => ({
  ledger: vi.fn(),
  users: vi.fn(),
  free: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
  }: {
    children: ReactNode
    params: { section: string }
  }) => <a href={`/finance/${params.section}`}>{children}</a>,
}))
vi.mock('@/features/ledger/api', () => ({
  getQuotaLedgerSummary: mocks.ledger,
}))
vi.mock('@/features/home/hooks', () => ({ useFreeGroupUsage: mocks.free }))
vi.mock('../../../hooks/use-top-spenders', () => ({
  useTopSpenders: mocks.users,
}))
vi.mock('@/features/users/components/dialogs/user-usage-dialog', () => ({
  UserUsageDialog: ({ username }: { username: string }) => (
    <div role='dialog'>{username}</div>
  ),
}))
vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({
    children,
    ...props
  }: {
    children: ReactNode
    'aria-label': string
  }) => <div aria-label={props['aria-label']}>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}))
vi.mock('recharts', () => ({
  AreaChart: () => <div>Chart</div>,
  Area: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

const range = {
  start: new Date('2025-01-10T12:00:00Z'),
  end: new Date('2025-01-11T12:00:00Z'),
}
const ledger = {
  range_paid_quota: 500000,
  daily_paid_usage: [{ date: '2025-01-10', paid_quota: 500000 }],
  paid_users: [{ user_id: 7, username: 'alice', paid_quota: 500000 }],
  credits: {
    manual_paid: 1500000,
    manual_bonus: 1000000,
    redemption_paid: 2000000,
    redemption_bonus: 500000,
    redemption_incomplete: 0,
    redemption_deleted: 0,
    online_paid: 2500000,
    online_incomplete: 0,
  },
}
function showOverview() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <UserBusinessOverview range={range} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.ledger.mockReset().mockResolvedValue(ledger)
  mocks.users.mockReset().mockReturnValue({
    data: {
      server_start_day: '2025-01-10',
      server_end_day: '2025-01-11',
      daily_activity: [{ day: '2025-01-10', users: 3 }],
      activity: { dau: 3 },
    },
    loading: false,
    error: false,
  })
  mocks.free.mockReset().mockReturnValue({
    data: { enabled: true, used: 12, daily_limit: 50 },
    isLoading: false,
    isError: false,
  })
})

describe('UserBusinessOverview', () => {
  test('shows honest business metrics and opens the selected user', async () => {
    const user = userEvent.setup()
    showOverview()
    const cards = screen.getByRole('region', { name: 'Operations Overview' })
    const credits = within(cards)
      .getByText('Credited quota')
      .closest('.bg-card') as HTMLElement
    expect(within(credits).getByText('Manual credit')).toBeVisible()
    expect(within(credits).getByText('Redemption code')).toBeVisible()
    expect(within(credits).getByText('Online top-up')).toBeVisible()
    expect(
      within(credits).getByRole('link', { name: 'Manual credit' })
    ).toHaveAttribute('href', '/finance/credits')
    expect(
      within(credits).getByRole('link', { name: 'Redemption code' })
    ).toHaveAttribute('href', '/finance/redemptions')
    expect(
      await within(credits).findByText(
        `Paid quota: ${formatQuota(1500000)} · Promotional credit: ${formatQuota(1000000)}`
      )
    ).toBeVisible()
    expect(
      within(credits).getByText(
        `Paid quota: ${formatQuota(2000000)} · Promotional credit: ${formatQuota(500000)}`
      )
    ).toBeVisible()
    expect(
      within(credits).getByText(`Paid quota: ${formatQuota(2500000)}`)
    ).toBeVisible()
    expect(
      within(credits).getByText(
        'Gross credits by source for selected server calendar days. Refunds are not deducted; amounts are not cash receipts.'
      )
    ).toBeVisible()
    expect(within(cards).getByText('Paid used')).toBeVisible()
    expect(within(cards).getByText('3')).toBeVisible()
    expect(within(cards).getByText('12 / 50')).toBeVisible()
    expect(await screen.findByRole('button', { name: 'alice' })).toBeVisible()
    expect(
      within(
        within(cards).getByText('Paid used').closest('.bg-card') as HTMLElement
      ).getByText(formatQuota(500000))
    ).toBeVisible()
    expect(mocks.ledger).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2025-01-10',
        endDate: '2025-01-11',
      }),
      true
    )
    await user.click(screen.getByRole('tab', { name: 'Active users' }))
    expect(screen.getByLabelText('Active users')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'alice' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('alice')
  })

  test('shows incomplete historic credits as unavailable while preserving manual credit', async () => {
    mocks.ledger.mockResolvedValueOnce({
      ...ledger,
      credits: {
        ...ledger.credits,
        online_incomplete: 1,
        redemption_incomplete: 1,
        redemption_deleted: 1,
      },
    })
    showOverview()
    const cards = screen.getByRole('region', { name: 'Operations Overview' })
    const credits = within(cards)
      .getByText('Credited quota')
      .closest('.bg-card') as HTMLElement
    expect(
      await within(credits).findByText(
        'Some historical records lack credit details. Open the source ledger to review them.'
      )
    ).toBeVisible()
    expect(within(credits).getAllByText('—')).toHaveLength(2)
    expect(
      within(credits).getByText(
        'Deleted redemption codes are included in the totals but are hidden in the source ledger.'
      )
    ).toBeVisible()
    expect(
      within(credits).getByText(
        `Paid quota: ${formatQuota(1500000)} · Promotional credit: ${formatQuota(1000000)}`
      )
    ).toBeVisible()
  })

  test('distinguishes an empty ranking from a failed ledger request', async () => {
    mocks.ledger.mockResolvedValueOnce({ ...ledger, paid_users: [] })
    const { unmount } = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <UserBusinessOverview range={range} />
      </QueryClientProvider>
    )
    expect(await screen.findByText('No usage data')).toBeVisible()
    unmount()
    mocks.ledger.mockRejectedValueOnce(new Error('unavailable'))
    showOverview()
    const ranking = await screen.findByRole('region', {
      name: 'Paid usage ranking',
    })
    expect(
      await within(ranking).findByText('Failed to load statistics')
    ).toBeVisible()
    expect(within(ranking).queryByText('No usage data')).not.toBeInTheDocument()
    const credits = screen
      .getByText('Credited quota')
      .closest('.bg-card') as HTMLElement
    expect(within(credits).getByText('Failed to load statistics')).toBeVisible()
  })
})
