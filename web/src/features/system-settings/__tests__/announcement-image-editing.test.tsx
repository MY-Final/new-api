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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { AnnouncementsSection } from '../content/announcements-section'

afterEach(() => vi.restoreAllMocks())

describe('announcement image editing', () => {
  it('blocks submission, closing and overlapping uploads until the image is ready', async () => {
    type UploadResponse = Awaited<ReturnType<typeof api.post>>
    let resolveUpload: ((value: UploadResponse) => void) | undefined
    const upload = new Promise<UploadResponse>((resolve) => {
      resolveUpload = resolve
    })
    const post = vi.spyOn(api, 'post').mockReturnValue(upload)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    client.setQueryData(['status'], { console_images_enabled: true })
    render(
      <QueryClientProvider client={client}>
        <AnnouncementsSection enabled data='[]' />
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add Announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Content' }), {
      target: { value: 'An announcement with a picture' },
    })
    const form = screen
      .getByRole('textbox', { name: 'Content' })
      .closest('form')
    if (!form) throw new Error('Announcement form is missing')
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    const clipboardData = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    }
    fireEvent.paste(form, { clipboardData })
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: /^Add$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Images')).toBeDisabled()
    fireEvent.paste(form, { clipboardData })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () =>
      resolveUpload?.({ data: { success: true, data: { id: 42 } } } as Awaited<
        ReturnType<typeof api.post>
      >)
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Add$/ })).toBeEnabled()
    )
    expect(post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/api/console-images/42'
    )
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(
      screen.getByText('An announcement with a picture')
    ).toBeInTheDocument()
    client.clear()
  })
})
