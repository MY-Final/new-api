/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getCanvasStorageKey, STORAGE_KEYS } from '@/features/canvas/constants'
import { useAuthStore } from '@/stores/auth-store'

import { Canvas } from '..'

const mocks = vi.hoisted(() => ({
  getAvailableGroups: vi.fn(),
  getAvailableModels: vi.fn(),
  downloadImage: vi.fn(),
  persistImageSource: vi.fn(),
  saveHistoryEntries: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('../api', () => ({
  editImage: vi.fn(),
  generateImages: vi.fn(),
  getAvailableGroups: mocks.getAvailableGroups,
  getAvailableModels: mocks.getAvailableModels,
}))

vi.mock('../lib/history', () => ({
  downloadImage: mocks.downloadImage,
  persistImageSource: mocks.persistImageSource,
  saveHistoryEntries: mocks.saveHistoryEntries,
}))

beforeEach(() => {
  sessionStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 7, username: 'user', role: 1 })
  mocks.getAvailableGroups.mockResolvedValue([])
  mocks.getAvailableModels.mockResolvedValue([])
})

afterEach(() => {
  sessionStorage.clear()
  useAuthStore.getState().auth.reset('idle')
})

describe('Canvas restore flow', () => {
  test('keeps a matching restore payload until an API key is imported', async () => {
    const restoreKey = getCanvasStorageKey(STORAGE_KEYS.RESTORE, 7)
    const restorePayload = JSON.stringify({
      userId: 7,
      prompt: 'a prompt waiting for an API key',
    })
    sessionStorage.setItem(restoreKey, restorePayload)

    render(<Canvas />)

    expect(
      await screen.findByText(
        'Your prompt is ready. Import an API key and it will be restored automatically.'
      )
    ).toBeInTheDocument()
    expect(sessionStorage.getItem(restoreKey)).toBe(restorePayload)
  })

  test('does not consume another user restore payload', async () => {
    const restoreKey = getCanvasStorageKey(STORAGE_KEYS.RESTORE, 84)
    const restorePayload = JSON.stringify({
      userId: 84,
      prompt: 'another user prompt',
    })
    sessionStorage.setItem(restoreKey, restorePayload)

    render(<Canvas />)

    await screen.findByText('No API key imported yet.')
    expect(
      screen.queryByText(
        'Your prompt is ready. Import an API key and it will be restored automatically.'
      )
    ).not.toBeInTheDocument()
    expect(sessionStorage.getItem(restoreKey)).toBe(restorePayload)
  })

  test('restores and consumes a matching payload after an API key is present', async () => {
    const restoreKey = getCanvasStorageKey(STORAGE_KEYS.RESTORE, 7)
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    sessionStorage.setItem(
      restoreKey,
      JSON.stringify({
        userId: 7,
        prompt: 'restore this prompt',
        model: 'image-model',
        size: '512x512',
        n: 2,
      })
    )

    render(<Canvas />)

    const prompt = await screen.findByPlaceholderText(
      'Describe the image you want to create...'
    )
    await waitFor(() => expect(prompt).toHaveValue('restore this prompt'))
    expect(sessionStorage.getItem(restoreKey)).toBe(null)
  })
})
