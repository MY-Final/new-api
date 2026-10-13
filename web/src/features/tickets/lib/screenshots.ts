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
import type { Screenshot } from '../types'

export async function encodeScreenshots(files: File[]): Promise<Screenshot[]> {
  if (
    files.length > 3 ||
    files.some(
      (file) =>
        file.size > 5 * 1024 * 1024 ||
        !['image/png', 'image/jpeg'].includes(file.type)
    )
  ) {
    throw new Error('Choose up to 3 PNG or JPEG screenshots, 5 MB each')
  }
  return Promise.all(
    files.map(async (file) => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener(
          'load',
          () => resolve(String(reader.result).split(',')[1] ?? ''),
          { once: true }
        )
        reader.addEventListener(
          'error',
          () => reject(new Error('Failed to read screenshot')),
          { once: true }
        )
        reader.readAsDataURL(file)
      })
      return { name: file.name, data }
    })
  )
}
