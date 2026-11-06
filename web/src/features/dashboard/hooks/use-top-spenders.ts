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
import { useTranslation } from 'react-i18next'

import { getAdminUserUsageRanking } from '@/features/usage-statistics/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { dateToUnixTimestamp } from '@/lib/time'

export const TOP_SPENDER_COUNT = 6

/**
 * Site-wide spending ranking for an administrator. The response also carries
 * the site activity counters (DAU/WAU/MAU), so callers that only need today's
 * active users share this query instead of requesting the same aggregation
 * twice.
 */
export function useTopSpenders(
  range: { start: Date; end: Date },
  refetchInterval?: number | false
) {
  const { t } = useTranslation()
  const start = dateToUnixTimestamp(range.start)
  const end = dateToUnixTimestamp(range.end)
  const query = useQuery({
    queryKey: ['dashboard', 'overview', 'top-spenders', start, end],
    queryFn: async () => {
      const result = requireServerSuccess(
        await getAdminUserUsageRanking({
          start_timestamp: start,
          end_timestamp: end,
          p: 1,
          page_size: TOP_SPENDER_COUNT,
          sort_by: 'user_cost',
        })
      )
      if (!result.data) throw new Error(t('Failed to load usage details'))
      return result.data
    },
    staleTime: 30_000,
    refetchInterval,
    retry: false,
  })

  return {
    data: query.data,
    loading: query.isLoading,
    error: query.isError,
    refetch: query.refetch,
  }
}
