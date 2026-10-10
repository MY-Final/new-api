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
export type CsvValue = string | number | null | undefined

/**
 * Excel on Windows opens UTF-8 CSV as mojibake unless the file starts with a
 * BOM, so every exported file carries one.
 */
const UTF8_BOM = '\ufeff'

function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/["\n\r,]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

/** Serializes rows (including a header row) into RFC 4180 CSV text. */
export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n')
}

/** Serializes rows and saves them as a BOM-prefixed UTF-8 CSV download. */
export function downloadCsv(filename: string, rows: CsvValue[][]): void {
  const blob = new Blob([UTF8_BOM + toCsv(rows)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
