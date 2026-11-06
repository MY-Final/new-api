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
const INVITE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/

export function normalizeInviteCode(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidInviteCode(value: string): boolean {
  return INVITE_CODE_PATTERN.test(normalizeInviteCode(value))
}
