import { useEffect, useEffectEvent, useState } from 'react'
import { SSE } from 'sse.js'

import { getFreshAuthHeaders } from '@/lib/api'

interface LogStreamSource {
  addEventListener: (
    type: string,
    listener: (event: Event & { data?: string }) => void
  ) => void
  stream: () => void
  close: () => void
}

interface LogLiveRefreshOptions {
  enabled: boolean
  isAdmin: boolean
  userId: number | undefined
  sessionId: string | undefined
  paused: boolean
  endTime?: number
  onRefresh: () => Promise<unknown>
}

export function useLogLiveRefresh(options: LogLiveRefreshOptions) {
  const [pending, setPending] = useState(false)
  const [connected, setConnected] = useState(false)
  const isPaused = useEffectEvent(
    () =>
      options.paused ||
      (options.endTime != null && options.endTime < Date.now()) ||
      document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
  )
  const refresh = useEffectEvent(options.onRefresh)

  useEffect(() => {
    if (!options.enabled || options.userId == null) return
    let disposed = false
    let source: LogStreamSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    let failures = 0
    let dirty = false
    let fetching = false
    let lastRefresh = Date.now()
    let lastResync = Date.now()
    let lastEvent = Date.now()
    let interval = options.isAdmin ? 5000 : 3000
    let retryRefreshAt = 0
    let streamConnected = false

    const markChanged = () => {
      dirty = true
      setPending(true)
    }

    const disconnect = () => {
      generation++
      const previous = source
      source = null
      previous?.close()
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      streamConnected = false
      setConnected(false)
    }

    const connect = async () => {
      disconnect()
      if (
        disposed ||
        document.visibilityState === 'hidden' ||
        !navigator.onLine
      ) {
        return
      }
      const attempt = generation
      const retry = () => {
        if (disposed || attempt !== generation) return
        disconnect()
        failures++
        const delay =
          Math.min(30000, 1000 * 2 ** Math.min(failures, 5)) +
          Math.floor(Math.random() * 1000)
        reconnectTimer = setTimeout(() => void connect(), delay)
      }
      try {
        const headers = await getFreshAuthHeaders()
        if (disposed || attempt !== generation) return
        const next = new SSE(
          options.isAdmin ? '/api/log/stream' : '/api/log/self/stream',
          { headers, method: 'GET', start: false }
        ) as LogStreamSource
        source = next
        lastEvent = Date.now()
        const receive = () => {
          if (disposed || attempt !== generation) return false
          lastEvent = Date.now()
          return true
        }
        const configureInterval = (event: Event & { data?: string }) => {
          if (!receive()) return false
          let settings: unknown
          try {
            settings = JSON.parse(event.data ?? '{}')
          } catch {
            retry()
            return false
          }
          const configured =
            settings != null &&
            typeof settings === 'object' &&
            'refresh_interval_ms' in settings
              ? settings.refresh_interval_ms
              : undefined
          if (typeof configured === 'number' && Number.isFinite(configured)) {
            interval = Math.max(1000, Math.min(configured, 60000))
          }
          return true
        }
        next.addEventListener('settings', configureInterval)
        next.addEventListener('ready', (event) => {
          if (!configureInterval(event)) return
          failures = 0
          streamConnected = true
          setConnected(true)
          lastResync = Date.now()
          dirty = true
        })
        next.addEventListener('changed', () => {
          if (receive()) markChanged()
        })
        next.addEventListener('resync', () => {
          if (!receive()) return
          lastResync = Date.now()
          dirty = true
        })
        next.addEventListener('heartbeat', receive)
        next.addEventListener('error', retry)
        next.addEventListener('readystatechange', (event) => {
          if ((event as Event & { readyState?: number }).readyState === 2) {
            retry()
          }
        })
        next.stream()
      } catch {
        retry()
      }
    }

    const tick = async () => {
      if (
        disposed ||
        document.visibilityState === 'hidden' ||
        !navigator.onLine
      ) {
        return
      }
      const now = Date.now()
      if (source && now - lastEvent > 45000) void connect()
      const resyncInterval = streamConnected ? 90000 : 30000
      if (now - lastResync >= resyncInterval) {
        lastResync = now
        dirty = true
      }
      if (
        !dirty ||
        fetching ||
        isPaused() ||
        now - lastRefresh < interval ||
        now < retryRefreshAt
      ) {
        return
      }
      fetching = true
      dirty = false
      lastRefresh = now
      try {
        await refresh()
      } catch {
        dirty = true
        retryRefreshAt = Date.now() + 30000
      } finally {
        fetching = false
        if (!disposed) setPending(dirty)
      }
    }

    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) {
        disconnect()
      } else {
        void connect()
      }
    }
    const timer = setInterval(() => void tick(), 1000)
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('online', visibilityChanged)
    window.addEventListener('offline', visibilityChanged)
    void connect()
    return () => {
      disposed = true
      disconnect()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('online', visibilityChanged)
      window.removeEventListener('offline', visibilityChanged)
    }
  }, [options.enabled, options.isAdmin, options.userId, options.sessionId])

  return { pending, connected }
}
