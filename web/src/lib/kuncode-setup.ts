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
 * Built-in download page for KunCode Setup. Administrators can override it with
 * `HeaderNavModules.setupDownloadUrl`; the override is validated on the server
 * and normalized while parsing the status payload.
 */
export const KUNCODE_SETUP_RELEASE_URL =
  'https://github.com/MY-Final/kuncode-setup/releases/latest'

/** Resolves the effective download URL, falling back to the built-in page. */
export function resolveSetupDownloadUrl(override?: string): string {
  const trimmed = override?.trim() ?? ''
  return trimmed || KUNCODE_SETUP_RELEASE_URL
}
