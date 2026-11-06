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
import { describe, expect, it } from 'vitest'

import { resolveApiBaseUrl } from '../api-base-url'

describe('resolveApiBaseUrl', () => {
  it.each([
    ['https://api.example.com', 'https://api.example.com/v1'],
    ['https://api.example.com/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1'],
    ['  https://api.example.com/proxy  ', 'https://api.example.com/proxy/v1'],
  ])('normalizes the configured address %s', (configured, expected) => {
    expect(resolveApiBaseUrl(configured, 'https://fallback.example.com')).toBe(
      expected
    )
  })

  it('uses the current origin with /v1 when no configured address is available', () => {
    expect(resolveApiBaseUrl(undefined, 'https://console.example.com')).toBe(
      'https://console.example.com/v1'
    )
  })
})
