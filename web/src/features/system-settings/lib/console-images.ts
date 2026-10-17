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
import { createServerError } from '@/lib/server-error-message'

import { uploadConsoleImage } from '../api'

export const CONSOLE_IMAGE_MAX_COUNT = 9
export const CONSOLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const CONSOLE_IMAGE_TYPES = ['image/png', 'image/jpeg']

export function consoleImageFilesFromClipboard(
  data: DataTransfer | null
): File[] {
  if (!data) return []
  const files: File[] = []
  for (const item of data.items) {
    if (item.kind !== 'file' || !CONSOLE_IMAGE_TYPES.includes(item.type)) {
      continue
    }
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

export async function appendConsoleImages(
  current: number[],
  files: File[]
): Promise<number[]> {
  if (files.length > CONSOLE_IMAGE_MAX_COUNT - current.length) {
    throw createServerError({ message_key: 'Up to 9 images are allowed' })
  }
  const ids: number[] = []
  for (const file of files) {
    ids.push(await uploadConsoleImageFile(file))
  }
  return [...current, ...ids]
}

async function uploadConsoleImageFile(file: File): Promise<number> {
  if (
    !CONSOLE_IMAGE_TYPES.includes(file.type) ||
    file.size > CONSOLE_IMAGE_MAX_BYTES
  ) {
    throw createServerError({
      message_key: 'Choose a PNG or JPEG image up to 5 MB',
    })
  }
  const response = await uploadConsoleImage(await readFileAsBase64(file))
  if (response.success === false) {
    throw createServerError(response)
  }
  const id = response.data?.id
  if (!id) {
    throw createServerError({ message_key: 'Console image upload failed' })
  }
  return id
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => resolve(String(reader.result).split(',')[1] ?? ''),
      { once: true }
    )
    reader.addEventListener(
      'error',
      () => reject(createServerError({ message_key: 'Failed to read image' })),
      { once: true }
    )
    reader.readAsDataURL(file)
  })
}
