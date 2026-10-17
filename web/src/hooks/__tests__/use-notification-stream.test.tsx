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
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useNotificationStream } from '@/hooks/use-notification-stream'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

type Listener = () => void

class MockEventSource {
  static instances: MockEventSource[] = []

  readonly url: string
  closed = false
  private listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener())
  }
}

const originalEventSource = globalThis.EventSource

function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    )
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances.at(-1)
  if (!source) throw new Error('EventSource was not created')
  return source
}

beforeEach(() => {
  MockEventSource.instances = []
  globalThis.EventSource = MockEventSource as unknown as typeof EventSource
})

afterEach(() => {
  globalThis.EventSource = originalEventSource
})

describe('useNotificationStream', () => {
  test('subscribes to the console notification stream on mount', () => {
    const queryClient = createQueryClient()
    renderHook(() => useNotificationStream(), {
      wrapper: wrapper(queryClient),
    })

    expect(latestSource().url).toBe('/api/notifications/stream')
  })

  test('refetches status when the announcements topic changes', () => {
    const queryClient = createQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useNotificationStream(), {
      wrapper: wrapper(queryClient),
    })

    act(() => latestSource().emit('announcements'))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: STATUS_QUERY_KEY })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  test('refetches the notice when the notice topic changes', () => {
    const queryClient = createQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useNotificationStream(), {
      wrapper: wrapper(queryClient),
    })

    act(() => latestSource().emit('notice'))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notice'] })
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  test('resyncs status and notice after the stream connects', () => {
    const queryClient = createQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useNotificationStream(), {
      wrapper: wrapper(queryClient),
    })

    act(() => latestSource().emit('ready'))

    expect(invalidate).toHaveBeenCalledWith({ queryKey: STATUS_QUERY_KEY })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notice'] })
  })

  test('closes the stream on unmount', () => {
    const queryClient = createQueryClient()
    const hook = renderHook(() => useNotificationStream(), {
      wrapper: wrapper(queryClient),
    })
    const source = latestSource()

    hook.unmount()

    expect(source.closed).toBe(true)
  })
})
