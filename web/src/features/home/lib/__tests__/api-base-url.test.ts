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
    ['https://first.example.com', 'https://first.example.com/v1'],
    ['https://second.example.com:8443', 'https://second.example.com:8443/v1'],
    ['http://localhost:3000', 'http://localhost:3000/v1'],
  ])(
    'uses the current origin %s even when another address is configured',
    (origin, expected) => {
      expect(resolveApiBaseUrl('https://configured.example.com', origin)).toBe(
        expected
      )
    }
  )

  it.each([
    ['https://api.example.com/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1'],
    ['  https://api.example.com/proxy  ', 'https://api.example.com/proxy/v1'],
  ])(
    'falls back to the configured address if the origin is unavailable',
    (configured, expected) => {
      expect(resolveApiBaseUrl(configured, '')).toBe(expected)
      expect(resolveApiBaseUrl(configured, 'null')).toBe(expected)
    }
  )

  it('uses a relative API path when neither address is available', () => {
    expect(resolveApiBaseUrl(undefined, '')).toBe('/v1')
  })
})
