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
import { afterEach, describe, expect, test, vi } from 'vitest'

import { generateImages } from '../../api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Canvas image requests', () => {
  test('retries once without response_format when the upstream rejects it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'response_format unsupported' },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: 'image' }] }),
      } as Response)

    await expect(
      generateImages({ model: 'image-model', prompt: 'a house' }, 'api-key')
    ).resolves.toEqual({ data: [{ b64_json: 'image' }] })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(firstBody.response_format).toBe('b64_json')
    expect(secondBody.response_format).toBeUndefined()
  })

  test('does not retry unrelated client errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'invalid prompt' } }),
    } as Response)

    await expect(
      generateImages({ model: 'image-model', prompt: 'bad' }, 'api-key')
    ).rejects.toMatchObject({ status: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
