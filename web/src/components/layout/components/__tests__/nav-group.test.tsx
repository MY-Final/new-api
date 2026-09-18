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
import { render, screen } from '@testing-library/react'
import { User, Wallet } from 'lucide-react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'

import type { NavGroup as NavGroupProps } from '../../types'
import { NavGroup } from '../nav-group'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    preload: _preload,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode
    to: string
    preload?: boolean
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: (options?: {
    select?: (location: { href: string }) => unknown
  }) => {
    const location = { href: '/dashboard' }
    return options?.select ? options.select(location) : location
  },
}))

function renderGroup(items: NavGroupProps['items']) {
  return render(
    <SidebarProvider>
      <NavGroup title='Personal' items={items} />
    </SidebarProvider>
  )
}

describe('NavGroup highlighted item', () => {
  test('accents the wallet entry and leaves regular entries unstyled', () => {
    renderGroup([
      { title: 'Wallet', url: '/wallet', icon: Wallet, highlight: true },
      { title: 'Profile', url: '/profile', icon: User },
    ])

    expect(screen.getByRole('link', { name: 'Wallet' })).toHaveClass(
      'text-amber-700'
    )
    expect(screen.getByRole('link', { name: 'Profile' })).not.toHaveClass(
      'text-amber-700'
    )
  })
})
