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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FreeGroupUsageState } from '../../types'
import { KunCodeHomePage } from '../kuncode-home-page'

const freeGroupUsage: FreeGroupUsageState = {
  usage: {
    enabled: true,
    group: 'free-eggs',
    daily_limit: 10000,
    used: 1234,
    remaining: 8766,
  },
  isLoading: false,
  isError: false,
}

async function renderHomePage(
  apiBaseUrl = 'https://api.example.com/v1',
  freeGroupUsageState: FreeGroupUsageState = freeGroupUsage
) {
  const root = createRootRoute({
    component: () => (
      <KunCodeHomePage
        apiBaseUrl={apiBaseUrl}
        freeGroupUsage={freeGroupUsageState}
      />
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()

  render(<RouterProvider router={router} />)
}

describe('KunCode home page', () => {
  it('shows the public free group allowance before the hero content', async () => {
    await renderHomePage()

    const usage = screen.getByRole('region', {
      name: 'Free group calls today',
    })
    const heading = screen.getByRole('heading', {
      name: 'In the world of codeAll-round trainee',
    })

    expect(usage).toBeVisible()
    expect(within(usage).getByText('free-eggs')).toBeVisible()
    expect(within(usage).getByText('Remaining today: 8,766')).toBeVisible()
    expect(
      usage.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('omits the free group allowance when the free group is off', async () => {
    await renderHomePage(undefined, {
      usage: {
        enabled: false,
        group: '',
        daily_limit: 10000,
        used: 0,
        remaining: 10000,
      },
      isLoading: false,
      isError: false,
    })

    expect(
      screen.queryByRole('region', {
        name: 'Free group calls today',
      })
    ).not.toBeInTheDocument()
  })

  it('renders the practice studio hero and links the main action to keys', async () => {
    await renderHomePage()

    expect(
      screen.getByText('Practicing for two and a half years · Running smoothly')
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: 'In the world of codeAll-round trainee',
      })
    ).toBeVisible()

    const action = screen.getByRole('button', {
      name: /Enter the practice room/,
    })
    expect(action).toHaveAttribute('href', '/keys')
  })

  it('shows the resolved API base URL in the copy and code examples', async () => {
    await renderHomePage('https://gateway.example.com/v1')

    expect(screen.getByText('https://gateway.example.com/v1')).toBeVisible()
    expect(screen.getByText('"https://gateway.example.com/v1"')).toBeVisible()
    expect(screen.getByText('Copy API')).toBeVisible()
  })
})
