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
import { useCallback, useState } from 'react'

/**
 * Shared auto-refresh preference for log pages. The value is the refresh
 * cadence in milliseconds; `0` means disabled and is the default when the
 * user has never picked one.
 */
export const AUTO_REFRESH_STORAGE_KEY = 'logs:auto-refresh-interval'

// Shared between the dashboard analytics and the operations monitoring page so
// an operator's cadence choice follows them across both views.
export const DASHBOARD_AUTO_REFRESH_STORAGE_KEY =
  'dashboard:auto-refresh-interval'

export const AUTO_REFRESH_INTERVALS = [
  { value: 0, labelKey: 'Off' },
  { value: 5000, labelKey: '5 seconds' },
  { value: 10000, labelKey: '10 seconds' },
  { value: 60000, labelKey: '1 minute' },
  { value: 300000, labelKey: '5 minutes' },
] as const

function readStoredInterval(storageKey: string): number {
  if (typeof window === 'undefined') return 0
  const stored = window.localStorage.getItem(storageKey)
  if (stored === null) return 0
  const parsed = Number(stored)
  return AUTO_REFRESH_INTERVALS.some((option) => option.value === parsed)
    ? parsed
    : 0
}

export function useAutoRefreshInterval(
  storageKey: string = AUTO_REFRESH_STORAGE_KEY
) {
  const [autoRefreshInterval, setAutoRefreshIntervalState] = useState(() =>
    readStoredInterval(storageKey)
  )
  const setAutoRefreshInterval = useCallback(
    (interval: number) => {
      setAutoRefreshIntervalState(interval)
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(storageKey, String(interval))
      } catch {
        // Storage may be unavailable; keep the in-memory selection.
      }
    },
    [storageKey]
  )

  return { autoRefreshInterval, setAutoRefreshInterval }
}
