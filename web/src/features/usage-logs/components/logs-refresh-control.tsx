import { ChevronDown, RefreshCw } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AUTO_REFRESH_INTERVALS, useMediaQuery } from '@/hooks'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { useLogLiveRefresh } from '../hooks/use-log-live-refresh'
import { useUsageLogsContext } from './usage-logs-provider'

export const LIVE_REFRESH_STORAGE_KEY = 'logs:live-refresh-enabled'

interface LogsRefreshControlProps {
  isAdmin: boolean
  pageIndex: number
  endTime: number | undefined
  onRefresh: () => Promise<unknown>
  onShowLatest: () => void
  refreshCycleKey?: number
}

export function LogsRefreshControl(props: LogsRefreshControlProps) {
  const { t } = useTranslation()
  const { autoRefreshInterval, setAutoRefreshInterval } = useUsageLogsContext()
  const [enabled, setEnabled] = useState(() => {
    if (autoRefreshInterval > 0 || typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(LIVE_REFRESH_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const shouldReduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const userId = useAuthStore((state) => state.auth.user?.id)
  const sessionId = useAuthStore((state) => state.auth.session?.sid)
  const paused =
    props.pageIndex !== 0 ||
    (props.endTime != null && props.endTime < Date.now())
  const { pending, connected } = useLogLiveRefresh({
    enabled: enabled && sessionId != null,
    isAdmin: props.isAdmin,
    userId,
    sessionId,
    paused: props.pageIndex !== 0,
    endTime: props.endTime,
    onRefresh: props.onRefresh,
  })
  const activeOption = AUTO_REFRESH_INTERVALS.find(
    (option) => option.value === autoRefreshInterval
  )
  const mode = enabled ? 'live' : String(autoRefreshInterval)
  let refreshLabel = t('Refresh')
  if (enabled) {
    refreshLabel = t('Live refresh')
  } else if (autoRefreshInterval > 0 && activeOption != null) {
    refreshLabel = `${t('Auto refresh')} · ${t(activeOption.labelKey)}`
  }
  let status = ''
  if (enabled && !connected) {
    status = t('Reconnecting')
  } else if (enabled && paused) {
    status = t('Live refresh paused')
  }

  const handleModeChange = (value: string) => {
    if (value === 'live') {
      setEnabled(true)
      setAutoRefreshInterval(0)
      try {
        window.localStorage.setItem(LIVE_REFRESH_STORAGE_KEY, 'true')
      } catch {
        // Keep the in-memory selection when storage is unavailable.
      }
      return
    }
    setEnabled(false)
    setAutoRefreshInterval(Number(value))
    try {
      window.localStorage.setItem(LIVE_REFRESH_STORAGE_KEY, 'false')
    } catch {
      // Keep the in-memory selection when storage is unavailable.
    }
  }

  return (
    <div className='flex shrink-0 items-center gap-2'>
      {status && (
        <span
          role='status'
          className='text-muted-foreground hidden text-xs whitespace-nowrap sm:inline'
        >
          {status}
        </span>
      )}
      {enabled && pending && (
        <Button size='sm' variant='outline' onClick={props.onShowLatest}>
          {t('New logs available')}
        </Button>
      )}
      <span
        data-slot='logs-refresh-control'
        data-refresh-interval={autoRefreshInterval}
        className={cn(
          'relative inline-flex shrink-0 rounded-lg',
          autoRefreshInterval > 0 && 'logs-refresh-active'
        )}
        style={
          autoRefreshInterval > 0
            ? ({
                '--logs-refresh-cycle': `${autoRefreshInterval}ms`,
              } as CSSProperties)
            : undefined
        }
      >
        {autoRefreshInterval > 0 && !shouldReduceMotion && (
          <span
            key={`${autoRefreshInterval}:${props.refreshCycleKey ?? 0}`}
            aria-hidden='true'
            data-refresh-progress-halo='true'
            className='logs-refresh-halo pointer-events-none absolute -inset-0.5 rounded-lg'
            style={{ animationDuration: `${autoRefreshInterval}ms` }}
          />
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='outline'
                className={cn(
                  'shrink-0',
                  (enabled || autoRefreshInterval > 0) &&
                    'border-primary/50 text-primary'
                )}
              />
            }
          >
            <RefreshCw aria-hidden='true' />
            {refreshLabel}
            {(enabled || autoRefreshInterval > 0) && (
              <span
                aria-hidden='true'
                className='size-1.5 rounded-full bg-emerald-500'
              />
            )}
            <ChevronDown
              className='text-muted-foreground size-3.5'
              aria-hidden='true'
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-56'>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{t('Refresh')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={handleModeChange}
              >
                <DropdownMenuRadioItem value='live' closeOnClick>
                  {t('Live refresh')}
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {AUTO_REFRESH_INTERVALS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={String(option.value)}
                    closeOnClick
                  >
                    {option.value === 0
                      ? t('Off')
                      : `${t('Auto refresh')} · ${t(option.labelKey)}`}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  )
}
