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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { ContactSection } from '../contact-section'

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
])

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <ContactSection
          defaultValues={{
            contact: {
              title: 'Need help?',
              description: '',
              qq_group_number: '123456789',
              qq_group_url: 'https://example.com/qq',
              qrcode: '',
            },
          }}
        />
      </SettingsPageProvider>
    </>
  )
}

async function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return screen.findByLabelText('QR code image')
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

test('uploads a PNG QR code and saves it as a data URI', async () => {
  const user = userEvent.setup()
  const input = await renderSection()
  expect(screen.getByLabelText('Contact title')).toHaveValue('Need help?')

  await user.upload(
    input,
    new File([PNG_BYTES], 'qq.png', { type: 'image/png' })
  )
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))

  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'contact.qrcode',
      value: expect.stringMatching(/^data:image\/png;base64,/),
    })
  )
})

test('rejects an unsupported QR image type without saving', async () => {
  const user = userEvent.setup()
  const input = await renderSection()

  fireEvent.change(input, {
    target: { files: [new File(['gif'], 'qq.gif', { type: 'image/gif' })] },
  })
  expect(
    await screen.findByText('Image must be a PNG or JPEG file.')
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  expect(api.put).not.toHaveBeenCalled()
})
