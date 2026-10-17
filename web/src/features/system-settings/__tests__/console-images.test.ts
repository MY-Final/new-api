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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadConsoleImage } from '../api'
import {
  appendConsoleImages,
  CONSOLE_IMAGE_MAX_COUNT,
  consoleImageFilesFromClipboard,
} from '../lib/console-images'

vi.mock('../api', () => ({
  uploadConsoleImage: vi.fn(),
}))

const mockedUpload = vi.mocked(uploadConsoleImage)

function pngFile(name = 'shot.png', size = 8): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' })
}

describe('console image uploads', () => {
  beforeEach(() => {
    mockedUpload.mockReset()
  })

  it('uploads accepted files in order and appends the returned ids', async () => {
    mockedUpload
      .mockResolvedValueOnce({ success: true, message: '', data: { id: 7 } })
      .mockResolvedValueOnce({ success: true, message: '', data: { id: 9 } })
    const images = await appendConsoleImages(
      [3],
      [
        pngFile(),
        new File([new Uint8Array(8)], 'photo.jpg', { type: 'image/jpeg' }),
      ]
    )
    expect(images).toEqual([3, 7, 9])
    expect(mockedUpload).toHaveBeenCalledTimes(2)
  })

  it('rejects unsupported and oversize files without calling the API', async () => {
    await expect(
      appendConsoleImages(
        [],
        [new File(['x'], 'note.txt', { type: 'text/plain' })]
      )
    ).rejects.toThrow('Choose a PNG or JPEG image up to 5 MB')
    await expect(
      appendConsoleImages(
        [],
        [
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', {
            type: 'image/png',
          }),
        ]
      )
    ).rejects.toThrow('Choose a PNG or JPEG image up to 5 MB')
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('rejects a batch that would exceed the image limit', async () => {
    const images = Array.from(
      { length: CONSOLE_IMAGE_MAX_COUNT },
      (_, index) => index + 1
    )
    await expect(appendConsoleImages(images, [pngFile()])).rejects.toThrow(
      'Up to 9 images are allowed'
    )
    expect(mockedUpload).not.toHaveBeenCalled()
  })

  it('surfaces the server refusal message', async () => {
    mockedUpload.mockResolvedValueOnce({
      success: false,
      message: 'Console image uploads are disabled',
    })
    await expect(appendConsoleImages([], [pngFile()])).rejects.toThrow(
      'Console image uploads are disabled'
    )
  })

  it('keeps only image files from clipboard data', () => {
    const image = pngFile()
    const files = consoleImageFilesFromClipboard({
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => image },
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'text/html', getAsFile: () => null },
      ],
    } as unknown as DataTransfer)
    expect(files).toEqual([image])
  })
})
