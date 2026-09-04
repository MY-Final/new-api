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
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  clearHistory,
  downloadImage,
  loadHistory,
  persistImageSource,
  removeHistoryEntry,
  saveHistoryEntries,
  type CanvasHistoryEntry,
} from '../history'

const DATABASE_NAME = 'new-api-canvas-history'

function createEntry(id: string, createdAt: number): CanvasHistoryEntry {
  return {
    id,
    image: `data:image/png;base64,${id}`,
    temporary: false,
    prompt: `prompt-${id}`,
    model: 'image-model',
    group: 'default',
    size: '1024x1024',
    n: 1,
    createdAt,
  }
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.addEventListener('success', () => resolve(), { once: true })
    request.addEventListener('error', () => reject(request.error), {
      once: true,
    })
    request.addEventListener(
      'blocked',
      () => reject(new Error('database delete blocked')),
      { once: true }
    )
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Canvas history storage', () => {
  test('keeps entries isolated by user and limits each user to 50 records', async () => {
    const entries = Array.from({ length: 55 }, (_, index) =>
      createEntry(`user-one-${index}`, index)
    )

    await expect(saveHistoryEntries(1, entries)).resolves.toEqual({
      success: true,
    })
    await expect(
      saveHistoryEntries(2, [createEntry('user-two', 100)])
    ).resolves.toEqual({
      success: true,
    })

    const userOneEntries = await loadHistory(1)
    expect(userOneEntries).toHaveLength(50)
    expect(userOneEntries[0].id).toBe('user-one-54')
    expect(userOneEntries.some((entry) => entry.id === 'user-one-0')).toBe(
      false
    )
    expect(await loadHistory(2)).toEqual([createEntry('user-two', 100)])
  })

  test('allows the same entry ID to exist for different users', async () => {
    await saveHistoryEntries(1, [createEntry('same-id', 1)])
    await saveHistoryEntries(2, [createEntry('same-id', 2)])

    await expect(loadHistory(1)).resolves.toEqual([createEntry('same-id', 1)])
    await expect(loadHistory(2)).resolves.toEqual([createEntry('same-id', 2)])
  })

  test('ignores malformed records instead of exposing invalid data', async () => {
    await saveHistoryEntries(1, [createEntry('valid', 1)])
    const request = indexedDB.open(DATABASE_NAME)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result), {
        once: true,
      })
      request.addEventListener('error', () => reject(request.error), {
        once: true,
      })
    })
    const transaction = database.transaction('entries', 'readwrite')
    transaction.objectStore('entries').put({
      id: 'invalid',
      userId: 1,
      image: 'data:image/png;base64,invalid',
      prompt: 'invalid',
      model: 'image-model',
      group: 'default',
      size: '1024x1024',
      n: 0,
      createdAt: 2,
    })
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), {
        once: true,
      })
      transaction.addEventListener('error', () => reject(transaction.error), {
        once: true,
      })
    })
    database.close()

    expect(await loadHistory(1)).toEqual([createEntry('valid', 1)])
  })

  test('returns an explicit unavailable result when IndexedDB is blocked', async () => {
    const originalIndexedDB = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: undefined,
    })

    await expect(loadHistory(1)).rejects.toMatchObject({
      reason: 'unavailable',
    })
    await expect(
      saveHistoryEntries(1, [createEntry('one', 1)])
    ).resolves.toEqual({
      success: false,
      reason: 'unavailable',
    })

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDB,
    })
  })

  test('keeps URL-only images as temporary when fetching the source fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 })
    )

    await expect(
      persistImageSource('https://example.com/image.png')
    ).resolves.toEqual({
      image: 'https://example.com/image.png',
      temporary: true,
    })
  })

  test('converts a reachable URL image to a data URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    } as Response)

    await expect(
      persistImageSource('https://example.com/image.png')
    ).resolves.toMatchObject({
      temporary: false,
      image: expect.stringMatching(/^data:image\/png;base64,/),
    })
  })

  test('does not treat HTTP errors as downloadable images', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 })
    )

    await expect(
      downloadImage('https://example.com/image.png', 'image.png')
    ).resolves.toBe(false)
  })

  test('clears only the requested user history', async () => {
    await saveHistoryEntries(1, [createEntry('one', 1)])
    await saveHistoryEntries(2, [createEntry('two', 2)])

    await clearHistory(1)

    await expect(loadHistory(1)).resolves.toEqual([])
    await expect(loadHistory(2)).resolves.toEqual([createEntry('two', 2)])
  })

  test('removes only the requested user entry', async () => {
    const userOneEntry = createEntry('same-id', 1)
    const userTwoEntry = createEntry('same-id', 2)
    await saveHistoryEntries(1, [userOneEntry])
    await saveHistoryEntries(2, [userTwoEntry])

    await removeHistoryEntry(1, userOneEntry.id)

    await expect(loadHistory(1)).resolves.toEqual([])
    await expect(loadHistory(2)).resolves.toEqual([userTwoEntry])
  })
})
