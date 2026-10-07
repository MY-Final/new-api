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

/**
 * Normalize the administrator-configured relay endpoints (`ApiBaseURLs`) from
 * the status payload. Only absolute http(s) URLs without credentials, query
 * strings, or fragments are kept, matching the backend validation, and the
 * result is de-duplicated.
 */
export function getAPIBaseURLs(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const urls = value.filter((item): item is string => {
    if (typeof item !== 'string') return false
    try {
      const url = new URL(item)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  })

  return [...new Set(urls)]
}
