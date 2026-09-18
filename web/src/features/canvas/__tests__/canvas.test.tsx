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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getCanvasStorageKey, STORAGE_KEYS } from '@/features/canvas/constants'
import { useAuthStore } from '@/stores/auth-store'

import { Canvas } from '..'

const mocks = vi.hoisted(() => ({
  getAvailableGroups: vi.fn(),
  getAvailableModels: vi.fn(),
  generateImages: vi.fn(),
  editImage: vi.fn(),
  downloadImage: vi.fn(),
  persistImageSource: vi.fn(),
  saveHistoryEntries: vi.fn(),
  loadHistory: vi.fn(),
  getApiKeys: vi.fn(),
  fetchTokenKey: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('../api', () => ({
  editImage: mocks.editImage,
  generateImages: mocks.generateImages,
  getAvailableGroups: mocks.getAvailableGroups,
  getAvailableModels: mocks.getAvailableModels,
}))

vi.mock('@/features/keys/api', () => ({
  getApiKeys: mocks.getApiKeys,
  fetchTokenKey: mocks.fetchTokenKey,
}))

vi.mock('../lib/history', () => ({
  downloadImage: mocks.downloadImage,
  loadHistory: mocks.loadHistory,
  persistImageSource: mocks.persistImageSource,
  saveHistoryEntries: mocks.saveHistoryEntries,
}))

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 7, username: 'user', role: 1 })
  mocks.getAvailableGroups.mockReset()
  mocks.getAvailableModels.mockReset()
  mocks.generateImages.mockReset()
  mocks.editImage.mockReset()
  mocks.saveHistoryEntries.mockReset()
  mocks.loadHistory.mockReset()
  mocks.downloadImage.mockReset()
  mocks.persistImageSource.mockReset()
  mocks.getApiKeys.mockReset()
  mocks.fetchTokenKey.mockReset()
  mocks.navigate.mockReset()
  mocks.getAvailableGroups.mockResolvedValue([])
  mocks.getAvailableModels.mockResolvedValue([])
  mocks.loadHistory.mockResolvedValue([])
  mocks.downloadImage.mockResolvedValue(true)
  mocks.getApiKeys.mockResolvedValue({
    success: true,
    data: { items: [], total: 0, page: 1, page_size: 100 },
  })
  URL.createObjectURL = vi.fn(() => 'blob:canvas')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset('idle')
})

function seedLastBatch(ids: string[] = ['entry-1', 'entry-2']) {
  const entries = [
    {
      id: 'entry-1',
      image: 'data:image/png;base64,AAA',
      prompt: 'first prompt',
      model: 'image-model',
      group: 'default',
      size: '1024x1024',
      n: 1,
      createdAt: 1,
    },
    {
      id: 'entry-2',
      image: 'data:image/png;base64,BBB',
      prompt: 'second prompt',
      model: 'image-model',
      group: 'default',
      size: '1024x1024',
      n: 1,
      createdAt: 2,
    },
  ]
  localStorage.setItem(
    getCanvasStorageKey(STORAGE_KEYS.LAST_BATCH, 7),
    JSON.stringify({ ids, createdAt: 1 })
  )
  mocks.loadHistory.mockResolvedValue(
    entries.filter((entry) => ids.includes(entry.id))
  )
}

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

  test('sends the composed size for the selected ratio and resolution', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.RESTORE, 7),
      JSON.stringify({ userId: 7, model: 'image-model', prompt: 'cats' })
    )
    mocks.generateImages.mockResolvedValue({ data: [] })
    mocks.saveHistoryEntries.mockResolvedValue({ success: true })

    render(<Canvas />)

    const prompt = await screen.findByPlaceholderText(
      'Describe the image you want to create...'
    )
    await waitFor(() => expect(prompt).toHaveValue('cats'))

    fireEvent.click(screen.getByRole('button', { name: '16:9' }))
    fireEvent.click(screen.getByRole('button', { name: '512P' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(mocks.generateImages).toHaveBeenCalledWith(
        expect.objectContaining({ size: '512x288', n: 1 }),
        'canvas-key',
        expect.anything()
      )
    )
  })

  test('omits the size when the ratio is automatic', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.RESTORE, 7),
      JSON.stringify({ userId: 7, model: 'image-model', prompt: 'cats' })
    )
    mocks.generateImages.mockResolvedValue({ data: [] })
    mocks.saveHistoryEntries.mockResolvedValue({ success: true })

    render(<Canvas />)

    const prompt = await screen.findByPlaceholderText(
      'Describe the image you want to create...'
    )
    await waitFor(() => expect(prompt).toHaveValue('cats'))

    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(mocks.generateImages).toHaveBeenCalledWith(
        expect.objectContaining({ size: undefined }),
        'canvas-key',
        expect.anything()
      )
    )
  })
})

describe('Canvas workspace persistence', () => {
  test('restores saved settings and the prompt draft', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.PROMPT, 7),
      'draft prompt'
    )
    localStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.MODEL, 7),
      'image-model'
    )
    localStorage.setItem(getCanvasStorageKey(STORAGE_KEYS.GROUP, 7), 'vip')

    render(<Canvas />)

    const modelInput = await screen.findByPlaceholderText(
      'Type or select a model'
    )
    await waitFor(() => expect(modelInput).toHaveValue('image-model'))
    expect(screen.getByPlaceholderText('Select a group')).toHaveValue('vip')
    expect(
      screen.getByPlaceholderText('Describe the image you want to create...')
    ).toHaveValue('draft prompt')
  })

  test('persists model changes for the user', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )

    render(<Canvas />)

    const modelInput = await screen.findByPlaceholderText(
      'Type or select a model'
    )
    fireEvent.change(modelInput, { target: { value: 'new-model' } })

    await waitFor(() =>
      expect(
        localStorage.getItem(getCanvasStorageKey(STORAGE_KEYS.MODEL, 7))
      ).toBe('new-model')
    )
  })

  test('restores the last generated batch and downloads all results', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    seedLastBatch()

    render(<Canvas />)

    await waitFor(() =>
      expect(screen.getByAltText('Generated image 1')).toHaveAttribute(
        'src',
        'data:image/png;base64,AAA'
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download all' }))

    await waitFor(() => expect(mocks.downloadImage).toHaveBeenCalledTimes(2))
  })

  test('fits a single result inside the result panel', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    seedLastBatch(['entry-1'])

    render(<Canvas />)

    const image = await screen.findByAltText('Generated image')
    expect(image).toHaveClass('h-full', 'w-full', 'object-contain')
  })

  test('navigates preview images with the arrow keys', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    seedLastBatch()

    render(<Canvas />)

    fireEvent.click(await screen.findByAltText('Generated image 1'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAA'
    )

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() =>
      expect(within(dialog).getByRole('img')).toHaveAttribute(
        'src',
        'data:image/png;base64,BBB'
      )
    )
  })
})

describe('Canvas generation loop', () => {
  test('generates with Ctrl+Enter', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.RESTORE, 7),
      JSON.stringify({ userId: 7, model: 'image-model', prompt: 'cats' })
    )
    mocks.generateImages.mockResolvedValue({ data: [] })
    mocks.saveHistoryEntries.mockResolvedValue({ success: true })

    render(<Canvas />)

    const prompt = await screen.findByPlaceholderText(
      'Describe the image you want to create...'
    )
    await waitFor(() => expect(prompt).toHaveValue('cats'))

    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(mocks.generateImages).toHaveBeenCalledTimes(1))
  })

  test('turns a generated result into a reference image', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.RESTORE, 7),
      JSON.stringify({ userId: 7, model: 'image-model', prompt: 'cats' })
    )
    mocks.generateImages.mockResolvedValue({ data: [{ b64_json: 'QUJD' }] })
    mocks.persistImageSource.mockImplementation(async (src: string) => ({
      image: src,
      temporary: false,
    }))
    mocks.saveHistoryEntries.mockResolvedValue({ success: true })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['image'], { type: 'image/png' }),
      })
    )

    render(<Canvas />)

    const prompt = await screen.findByPlaceholderText(
      'Describe the image you want to create...'
    )
    await waitFor(() => expect(prompt).toHaveValue('cats'))
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Use as reference image' })
    )

    expect(
      await screen.findByText(
        '1 image(s) selected. The first image is used as a reference.'
      )
    ).toBeInTheDocument()
  })
})

describe('Canvas API key import', () => {
  test('imports a selected API key and restores the pending prompt', async () => {
    const restoreKey = getCanvasStorageKey(STORAGE_KEYS.RESTORE, 7)
    sessionStorage.setItem(
      restoreKey,
      JSON.stringify({ userId: 7, prompt: 'restore this prompt' })
    )
    mocks.getApiKeys.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 11, name: 'Canvas Key', status: 1, group: 'vip' }],
      },
    })
    mocks.fetchTokenKey.mockResolvedValue({
      success: true,
      data: { key: 'secret-value' },
    })

    render(<Canvas />)

    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('combobox', { name: 'Select an API key' })
    )
    await user.click(await screen.findByRole('option', { name: 'Canvas Key' }))

    await waitFor(() =>
      expect(
        sessionStorage.getItem(getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7))
      ).toBe('sk-secret-value')
    )
    expect(mocks.fetchTokenKey).toHaveBeenCalledWith(11)
    expect(
      sessionStorage.getItem(getCanvasStorageKey(STORAGE_KEYS.GROUP, 7))
    ).toBe('vip')
    const prompt = await screen.findByPlaceholderText(
      'Describe the image you want to create...'
    )
    await waitFor(() => expect(prompt).toHaveValue('restore this prompt'))
    expect(sessionStorage.getItem(restoreKey)).toBe(null)
  })

  test('guides users without API keys to create one', async () => {
    render(<Canvas />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Create API Key' })
    )

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/keys' })
  })

  test('switches the imported API key from the Canvas header', async () => {
    sessionStorage.setItem(
      getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7),
      'canvas-key'
    )

    render(<Canvas />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch API Key' })
    )

    expect(
      sessionStorage.getItem(getCanvasStorageKey(STORAGE_KEYS.API_KEY, 7))
    ).toBe(null)
    expect(
      await screen.findByText('No API key imported yet.')
    ).toBeInTheDocument()
  })
})
