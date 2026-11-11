import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import traditionalChinese from '@/i18n/locales/zh-TW.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { TokenActivityCard } from '../token-activity-card'

const daySeconds = 86400
const today = Date.parse('2026-11-11T00:00:00Z') / 1000
const dailyUsage = [
  { day: '2025-11-12', total_tokens: 250 },
  { day: '2026-11-10', total_tokens: 300 },
  { day: '2026-11-11', total_tokens: 500 },
]

let queryClient: QueryClient

function renderCard() {
  return render(
    <QueryClientProvider client={queryClient}>
      <TokenActivityCard />
    </QueryClientProvider>
  )
}

function mockUsage() {
  let activeRequests = 0
  let peakRequests = 0
  const requests = vi
    .spyOn(api, 'get')
    .mockImplementation(async (_, config) => {
      activeRequests++
      peakRequests = Math.max(peakRequests, activeRequests)
      await Promise.resolve()
      activeRequests--
      const params = config?.params as {
        start_timestamp: number
        end_timestamp: number
      }
      const start = new Date(params.start_timestamp * 1000)
        .toISOString()
        .slice(0, 10)
      const end = new Date(params.end_timestamp * 1000)
        .toISOString()
        .slice(0, 10)
      return {
        data: {
          success: true,
          data: {
            daily: dailyUsage.filter(
              (day) => day.day >= start && day.day <= end
            ),
          },
        },
      }
    })
  return { requests, peakRequests: () => peakRequests }
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-11T15:00:00Z'))
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  useAuthStore.getState().auth.setUser({ id: 7, username: 'user', role: 1 })
})

afterEach(async () => {
  queryClient.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
  i18next.removeResourceBundle('zhTW', 'translation')
})

describe('token activity calendar', () => {
  it('combines the full UTC year in bounded, non-overlapping requests', async () => {
    const { requests, peakRequests } = mockUsage()
    renderCard()

    expect(
      await screen.findByRole('button', { name: 'Nov 11, 2026: 500 tokens' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Today (UTC)').nextElementSibling
    ).toHaveTextContent('500')
    expect(
      screen.getByText('Last 365 days').nextElementSibling
    ).toHaveTextContent('1,050')

    const ranges = requests.mock.calls
      .map(
        ([, config]) =>
          config?.params as {
            start_timestamp: number
            end_timestamp: number
          }
      )
      .sort((left, right) => left.start_timestamp - right.start_timestamp)
    expect(ranges).toHaveLength(12)
    expect(peakRequests()).toBeLessThanOrEqual(3)
    expect(ranges[0].start_timestamp).toBe(today - 364 * daySeconds)
    expect(ranges.at(-1)?.end_timestamp).toBe(today + daySeconds - 1)
    ranges.forEach((range, index) => {
      expect(range.end_timestamp - range.start_timestamp).toBeLessThan(
        31 * daySeconds
      )
      if (index > 0) {
        expect(range.start_timestamp).toBe(ranges[index - 1].end_timestamp + 1)
      }
    })
  })

  it('shows empty days and selects dates by pointer or keyboard', async () => {
    mockUsage()
    renderCard()

    const todayButton = await screen.findByRole('button', {
      name: 'Nov 11, 2026: 500 tokens',
    })
    const yesterdayButton = screen.getByRole('button', {
      name: 'Nov 10, 2026: 300 tokens',
    })
    const emptyButton = screen.getByRole('button', {
      name: 'Nov 9, 2026: 0 tokens',
    })
    expect(todayButton).toHaveAttribute('aria-pressed', 'true')
    expect(todayButton).toHaveAttribute('data-level', '4')
    expect(yesterdayButton).toHaveAttribute('data-level', '3')
    expect(emptyButton).toHaveAttribute('data-level', '0')

    fireEvent.click(yesterdayButton)
    expect(yesterdayButton).toHaveAttribute('aria-pressed', 'true')
    expect(todayButton).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Nov 10, 2026: 300 tokens')).toBeInTheDocument()

    fireEvent.keyDown(yesterdayButton, { key: 'ArrowUp' })
    expect(emptyButton).toHaveFocus()
    expect(emptyButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Nov 9, 2026: 0 tokens')).toBeInTheDocument()
    const calendar = screen.getByRole('grid', {
      name: 'Token activity calendar',
    })
    expect(calendar.querySelectorAll('button[tabindex="0"]')).toHaveLength(1)
  })

  it('keeps the calendar usable when there is no recorded usage', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { daily: [] } },
    })
    renderCard()

    expect(
      await screen.findByRole('button', { name: 'Nov 11, 2026: 0 tokens' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Last 365 days').nextElementSibling
    ).toHaveTextContent('0')
  })

  it('updates date and number labels when the interface language changes', async () => {
    mockUsage()
    renderCard()

    await screen.findByRole('button', { name: 'Nov 11, 2026: 500 tokens' })
    i18next.addResourceBundle(
      'zhTW',
      'translation',
      traditionalChinese.translation
    )
    await act(async () => {
      await i18next.changeLanguage('zhTW')
    })

    expect(
      screen.getByRole('button', { name: '2026年11月11日：500 個 Token' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('近 365 天').nextElementSibling).toHaveTextContent(
      '1,050'
    )
  })

  it('offers a retry instead of reporting a partial total when a request fails', async () => {
    let failOnce = true
    vi.spyOn(api, 'get').mockImplementation(async () => {
      if (failOnce) {
        failOnce = false
        return { data: { success: false, message: 'Unavailable' } }
      }
      return { data: { success: true, data: { daily: [] } } }
    })
    renderCard()

    expect(
      await screen.findByText('Failed to load usage details')
    ).toBeInTheDocument()
    expect(screen.queryByText('Last 365 days')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('button', { name: 'Nov 11, 2026: 0 tokens' })
    ).toBeInTheDocument()
  })

  it('stops requesting further ranges after leaving the page', async () => {
    const releases: Array<() => void> = []
    const requests = vi.spyOn(api, 'get').mockImplementation(async () => {
      await new Promise<void>((resolve) => releases.push(resolve))
      return { data: { success: true, data: { daily: [] } } }
    })
    const view = renderCard()

    await waitFor(() => expect(requests).toHaveBeenCalledTimes(3))
    view.unmount()
    await act(async () => {
      releases.forEach((release) => release())
    })
    expect(requests).toHaveBeenCalledTimes(3)
  })

  it('starts scrolled to the most recent dates on narrow screens', async () => {
    mockUsage()
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1000)
    renderCard()

    await screen.findByRole('button', { name: 'Nov 11, 2026: 500 tokens' })
    const scroller = screen.getByRole('region', {
      name: 'Token activity calendar',
    })
    expect(scroller).toHaveClass('overflow-x-auto')
    await waitFor(() => expect(scroller.scrollLeft).toBe(1000))
  })

  it('moves today forward after the UTC date changes', async () => {
    mockUsage()
    renderCard()

    await screen.findByRole('button', { name: 'Nov 11, 2026: 500 tokens' })
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-12T00:00:01Z'))
    fireEvent(document, new Event('visibilitychange'))

    expect(
      await screen.findByRole('button', { name: 'Nov 12, 2026: 0 tokens' })
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
