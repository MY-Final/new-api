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
export interface LogsDrilldownTarget {
  start: Date
  end: Date
  model?: string
  channel?: number
  username?: string
  token?: string
  errorOnly?: boolean
}

/**
 * Builds the /usage-logs search params for a dashboard drill-down. Times use
 * the URL's millisecond convention while filters reuse the log page's keys.
 */
export function buildLogsDrilldownSearch(target: LogsDrilldownTarget) {
  return {
    startTime: target.start.getTime(),
    endTime: target.end.getTime(),
    model: target.model,
    channel: target.channel != null ? String(target.channel) : undefined,
    username: target.username,
    token: target.token,
    type: target.errorOnly ? (['5'] as const) : undefined,
    page: 1,
  }
}
