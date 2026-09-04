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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { CanvasHistory } from '..'

const mocks = vi.hoisted(() => ({
  clearHistory: vi.fn(),
  copyToClipboard: vi.fn(),
  discardLegacyHistory: vi.fn(),
  downloadImage: vi.fn(),
  getLegacyHistory: vi.fn(() => []),
  loadHistory: vi.fn(),
  markLegacyMigrationPromptShown: vi.fn(),
  migrateLegacyHistory: vi.fn(),
  removeHistoryEntry: vi.fn(),
  restoreHistoryEntry: vi.fn(),
  shouldShowLegacyMigrationPrompt: vi.fn(() => false),
  subscribeHistoryChanges: vi.fn(() => () => undefined),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/lib/copy-to-clipboard', () => ({
  copyToClipboard: mocks.copyToClipboard,
}))

vi.mock('@/features/canvas/lib/history', () => ({
  clearHistory: mocks.clearHistory,
  discardLegacyHistory: mocks.discardLegacyHistory,
  downloadImage: mocks.downloadImage,
  getLegacyHistory: mocks.getLegacyHistory,
  loadHistory: mocks.loadHistory,
  markLegacyMigrationPromptShown: mocks.markLegacyMigrationPromptShown,
  migrateLegacyHistory: mocks.migrateLegacyHistory,
  removeHistoryEntry: mocks.removeHistoryEntry,
  restoreHistoryEntry: mocks.restoreHistoryEntry,
  shouldShowLegacyMigrationPrompt: mocks.shouldShowLegacyMigrationPrompt,
  subscribeHistoryChanges: mocks.subscribeHistoryChanges,
}))

const entry = {
  id: 'entry-1',
  image: 'data:image/png;base64,image',
  prompt: 'a blue house by the sea',
  model: 'image-model',
  group: 'default',
  size: '1024x1024',
  n: 1,
  createdAt: 1,
}

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 7, username: 'user', role: 1 })
  mocks.loadHistory.mockReset().mockResolvedValue([])
  mocks.clearHistory.mockReset().mockResolvedValue(undefined)
  mocks.copyToClipboard.mockReset().mockResolvedValue(true)
  mocks.downloadImage.mockReset().mockResolvedValue(true)
  mocks.removeHistoryEntry.mockReset().mockResolvedValue(undefined)
  mocks.restoreHistoryEntry.mockReset().mockResolvedValue({ success: true })
  mocks.toast.error.mockReset()
  mocks.toast.success.mockReset()
  mocks.toast.warning.mockReset()
})

afterEach(() => {
  useAuthStore.getState().auth.reset('idle')
})

describe('CanvasHistory', () => {
  test('shows loading, then the empty state after history loads', async () => {
    render(<CanvasHistory />)

    expect(screen.getByText('Loading drawing records...')).toBeInTheDocument()
    expect(
      await screen.findByText('No drawing records yet.')
    ).toBeInTheDocument()
  })

  test('shows a retry action after loading fails', async () => {
    mocks.loadHistory.mockRejectedValueOnce(new Error('blocked'))
    render(<CanvasHistory />)

    expect(
      await screen.findByText(
        'Unable to load drawing records. Please try again.'
      )
    ).toBeInTheDocument()
    mocks.loadHistory.mockResolvedValueOnce([])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByText('No drawing records yet.')
    ).toBeInTheDocument()
    expect(mocks.loadHistory).toHaveBeenCalledTimes(2)
  })

  test('opens a keyboard-accessible preview and copies the prompt', async () => {
    mocks.loadHistory.mockResolvedValueOnce([entry])
    render(<CanvasHistory />)

    const previewButton = await screen.findByRole('button', {
      name: 'Preview a blue house by the sea',
    })
    const user = userEvent.setup()
    previewButton.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(entry.prompt)
    )
  })

  test('requires confirmation before clearing records', async () => {
    mocks.loadHistory.mockResolvedValueOnce([entry])
    render(<CanvasHistory />)

    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('Clear drawing records?')
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(mocks.clearHistory).toHaveBeenCalledWith(7))
  })

  test('deletes immediately and offers an undo action', async () => {
    mocks.loadHistory.mockResolvedValueOnce([entry])
    render(<CanvasHistory />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(mocks.removeHistoryEntry).toHaveBeenCalledWith(7, entry.id)
    )
    expect(screen.queryByAltText(entry.prompt)).not.toBeInTheDocument()

    const [, options] = mocks.toast.success.mock.calls[0]
    options.action.onClick()
    await waitFor(() =>
      expect(mocks.restoreHistoryEntry).toHaveBeenCalledWith(7, entry)
    )
  })

  test('labels temporary image links clearly', async () => {
    mocks.loadHistory.mockResolvedValueOnce([{ ...entry, temporary: true }])
    render(<CanvasHistory />)

    expect(
      await screen.findByText('Temporary image link may expire.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open original' })
    ).toBeInTheDocument()
  })
})
