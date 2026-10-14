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
import { afterEach, expect, it, vi } from 'vitest'

import { downloadCsv, toCsv } from '../csv'

it('escapes separators, quotes and line breaks', () => {
  const csv = toCsv([
    ['用户', '原因'],
    ['a,b', 'say "hi"'],
    ['line\nbreak', ''],
  ])

  expect(csv).toBe(
    '用户,原因\r\n"a,b","say ""hi"""\r\n"line\nbreak",'
  )
})

it('renders empty values for null and undefined', () => {
  expect(toCsv([[null, undefined, 0]])).toBe(',,0')
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('downloads the CSV with a UTF-8 BOM so Excel shows non-ASCII text', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:csv')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  const clicks: string[] = []
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download)
    })

  downloadCsv('finance-topups.csv', [['a'], ['b']])

  expect(createObjectURL).toHaveBeenCalledTimes(1)
  const blob = createObjectURL.mock.calls[0][0]
  expect(blob.type).toBe('text/csv;charset=utf-8')
  expect(clicks).toEqual(['finance-topups.csv'])
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
  clickSpy.mockRestore()
  vi.unstubAllGlobals()
})
