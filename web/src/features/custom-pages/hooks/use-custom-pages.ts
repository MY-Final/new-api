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

import {
  buildCustomPageLinks,
  type CustomPageLink,
} from '@/lib/custom-pages'

import { getCustomPages } from '../api'

export const CUSTOM_PAGES_QUERY_KEY = ['custom-pages'] as const

export function useCustomPages(): {
  links: CustomPageLink[]
  isLoading: boolean
  isError: boolean
} {
  const query = useQuery({
    queryKey: CUSTOM_PAGES_QUERY_KEY,
    queryFn: getCustomPages,
    staleTime: 5 * 60 * 1000,
  })

  const links = useMemo(
    () => buildCustomPageLinks(query.data ?? []),
    [query.data]
  )

  return {
    links,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
