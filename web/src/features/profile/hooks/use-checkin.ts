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
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { formatQuotaWithCurrency } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { getCheckinStatus, performCheckin } from '../api'
import type { CheckinStatusResponse } from '../types'

const CHECKIN_STATUS_STALE_TIME = 30_000

export type CheckinTurnstileState = {
  visible: boolean
  widgetKey: number
  setVisible: (visible: boolean) => void
  verify: (token: string) => void
  retry: () => void
}

type CheckinController = {
  data: CheckinStatusResponse | undefined
  isLoading: boolean
  checkedToday: boolean
  todayAward: number | undefined
  todayString: string
  recordsMap: Record<string, number>
  monthlyQuota: number
  checkinLoading: boolean
  startCheckin: () => void
  turnstile: CheckinTurnstileState
}

type UseCheckinOptions = {
  /** Feature flag from `/api/status`; the status query is skipped when false. */
  enabled: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
  /** Month to query, formatted as `YYYY-MM`. */
  month: string
}

/**
 * Shared check-in data and action state for every check-in surface. The
 * calendar card and the floating window mount this hook against the same
 * `['checkin-status', month]` cache entry, so they never double-fetch.
 */
export function useCheckin(options: UseCheckinOptions): CheckinController {
  const { t } = useTranslation()
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [turnstileVisible, setTurnstileVisible] = useState(false)
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0)

  /* eslint-disable @tanstack/query/exhaustive-deps */
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['checkin-status', options.month],
    queryFn: async () => {
      const res = await getCheckinStatus(options.month)
      if (res.success && res.data) {
        return res.data
      }
      throw createServerError(res, t('Failed to fetch checkin status'))
    },
    enabled: options.enabled,
    staleTime: CHECKIN_STATUS_STALE_TIME,
  })
  /* eslint-enable @tanstack/query/exhaustive-deps */

  const recordsMap = useMemo(() => {
    const map: Record<string, number> = {}
    for (const record of data?.stats?.records ?? []) {
      map[record.checkin_date] = record.quota_awarded
    }
    return map
  }, [data?.stats?.records])

  const monthlyQuota = useMemo(
    () =>
      (data?.stats?.records ?? []).reduce(
        (sum, record) => sum + (record.quota_awarded || 0),
        0
      ),
    [data?.stats?.records]
  )

  const todayString = useMemo(() => dayjs().format('YYYY-MM-DD'), [])
  const checkedToday = data?.stats?.checked_in_today === true
  const todayAward = recordsMap[todayString]

  const shouldTriggerTurnstile = useCallback(
    (message?: string) => {
      if (!options.turnstileEnabled) return false
      if (typeof message !== 'string') return true
      return message.includes('Turnstile')
    },
    [options.turnstileEnabled]
  )

  const submitCheckin = useCallback(
    async (token?: string) => {
      setCheckinLoading(true)
      try {
        const res = await performCheckin(token)
        if (res.success && res.data) {
          toast.success(
            `${t('Check-in successful! Received')} ${formatQuotaWithCurrency(res.data.quota_awarded)}`
          )
          refetch()
          setTurnstileVisible(false)
          return
        }
        if (!token && shouldTriggerTurnstile(res.message)) {
          if (!options.turnstileSiteKey) {
            toast.error(t('Turnstile is enabled but site key is empty.'))
            return
          }
          setTurnstileVisible(true)
          return
        }
        if (token && shouldTriggerTurnstile(res.message)) {
          setTurnstileWidgetKey((value) => value + 1)
        }
        handleServerError(res, t('Check-in failed'))
      } catch (error) {
        handleServerError(error, t('Check-in failed'))
      } finally {
        setCheckinLoading(false)
      }
    },
    [refetch, shouldTriggerTurnstile, t, options.turnstileSiteKey]
  )

  const startCheckin = useCallback(() => {
    void submitCheckin()
  }, [submitCheckin])

  const setTurnstileDialogVisible = useCallback((visible: boolean) => {
    setTurnstileVisible(visible)
    if (!visible) setTurnstileWidgetKey((value) => value + 1)
  }, [])

  const retryTurnstile = useCallback(() => {
    setTurnstileWidgetKey((value) => value + 1)
  }, [])

  const verifyTurnstile = useCallback(
    (token: string) => {
      void submitCheckin(token)
    },
    [submitCheckin]
  )

  const turnstile = useMemo<CheckinTurnstileState>(
    () => ({
      visible: turnstileVisible,
      widgetKey: turnstileWidgetKey,
      setVisible: setTurnstileDialogVisible,
      verify: verifyTurnstile,
      retry: retryTurnstile,
    }),
    [
      retryTurnstile,
      setTurnstileDialogVisible,
      turnstileVisible,
      turnstileWidgetKey,
      verifyTurnstile,
    ]
  )

  return {
    data,
    isLoading,
    checkedToday,
    todayAward,
    todayString,
    recordsMap,
    monthlyQuota,
    checkinLoading,
    startCheckin,
    turnstile,
  }
}
