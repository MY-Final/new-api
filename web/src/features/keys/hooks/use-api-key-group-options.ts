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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { getSelfSubscriptionFull } from '@/features/subscriptions/api'
import { getUserGroups } from '@/lib/api'
import {
  requireServerSuccess,
  translateServerText,
} from '@/lib/server-error-message'

import type { ApiKeyGroupOption } from '../components/api-key-group-combobox'

const EMPTY_GROUP_OPTIONS: ApiKeyGroupOption[] = []
const EMPTY_SUBSCRIPTION_RATIOS: Record<string, number> = {}

export function useApiKeyGroupOptions(enabled?: boolean): {
  options: ApiKeyGroupOption[]
  isFetched: boolean
  isFetching: boolean
} {
  const { t } = useTranslation()
  const groupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    ...(enabled === undefined ? {} : { enabled }),
    staleTime: 0,
  })
  const subscriptionRatiosQuery = useQuery({
    queryKey: ['self', 'subscription', 'ratios'],
    queryFn: async () => {
      try {
        const res = await getSelfSubscriptionFull()
        if (!res.success || !res.data) return EMPTY_SUBSCRIPTION_RATIOS
        if (res.data.billing_preference === 'wallet_only') {
          return EMPTY_SUBSCRIPTION_RATIOS
        }
        const nowSeconds = Date.now() / 1000
        const ratioMap: Record<string, number> = {}
        for (const record of res.data.subscriptions || []) {
          const subscription = record?.subscription
          if (!subscription || subscription.status !== 'active') continue
          if (
            (subscription.end_time || 0) > 0 &&
            subscription.end_time < nowSeconds
          ) {
            continue
          }
          const ratios = subscription.route_group_ratios || {}
          for (const group of subscription.route_groups || []) {
            const ratio = Number(ratios[group] || 0)
            if (
              ratio > 0 &&
              (ratioMap[group] == null || ratio < ratioMap[group])
            ) {
              ratioMap[group] = ratio
            }
          }
        }
        return ratioMap
      } catch {
        return EMPTY_SUBSCRIPTION_RATIOS
      }
    },
    ...(enabled === undefined ? {} : { enabled }),
    staleTime: 30_000,
    retry: false,
  })

  const subscriptionRatios =
    subscriptionRatiosQuery.data ?? EMPTY_SUBSCRIPTION_RATIOS
  const options = useMemo(() => {
    const groups = groupsQuery.data?.data
    if (!groups) return EMPTY_GROUP_OPTIONS

    return Object.entries(groups).map(([group, info]) => ({
      value: group,
      label: group,
      desc: info.desc ? translateServerText(t, info.desc) : group,
      ratio: info.ratio,
    }))
  }, [groupsQuery.data, t])
  const optionsWithSubscriptionRatios = useMemo(
    () =>
      options.map((option) => {
        if (typeof option.ratio !== 'number') return option
        const subscriptionRatio = subscriptionRatios[option.value]
        if (
          subscriptionRatio === undefined ||
          subscriptionRatio >= option.ratio
        ) {
          return option
        }
        return {
          ...option,
          ratio: subscriptionRatio,
          originalRatio: option.ratio,
        }
      }),
    [options, subscriptionRatios]
  )

  return {
    options: optionsWithSubscriptionRatios,
    isFetched: groupsQuery.isFetched,
    isFetching: groupsQuery.isFetching,
  }
}
