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
import {
  buildCustomPageLinks,
  parseCustomPagesOption,
} from '@/lib/custom-pages'

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

function renderGroup(
  items: NavGroupProps['items'],
  props: Pick<NavGroupProps, 'id' | 'title'> = {
    title: 'Personal',
  }
) {
  return render(
    <SidebarProvider>
      <NavGroup {...props} items={items} />
    </SidebarProvider>
  )
}

describe('NavGroup highlighted item', () => {
  test.each(['light', 'dark'])(
    'keeps custom solid and gradient accents in the %s theme',
    (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
      try {
        const items = buildCustomPageLinks(
          parseCustomPagesOption(
            JSON.stringify([
              {
                name: 'Cyan status',
                url: 'https://status.example.com',
                highlight: true,
                highlightColor: 'cyan',
              },
              {
                name: 'Aurora shop',
                url: 'https://shop.example.com',
                highlight: true,
                highlightColor: 'aurora',
              },
              {
                name: 'Plain status',
                url: 'https://plain.example.com',
                highlight: false,
                highlightColor: 'cyan',
              },
            ])
          )
        ).map((page) => ({
          title: page.name,
          url: page.href,
          highlight: page.highlight,
          highlightColor: page.highlightColor,
        }))
        renderGroup(items)
        expect(screen.getByRole('link', { name: 'Cyan status' })).toHaveClass(
          'text-cyan-700',
          'dark:text-cyan-300'
        )
        expect(screen.getByRole('link', { name: 'Aurora shop' })).toHaveClass(
          'bg-linear-to-r',
          'from-emerald-400/15',
          'to-violet-500/15',
          'dark:text-teal-300'
        )
        expect(
          screen.getByRole('link', { name: 'Plain status' })
        ).not.toHaveClass('text-cyan-700')
      } finally {
        document.documentElement.classList.remove('dark')
      }
    }
  )

  test('keeps the selected gradient when its destination is active', () => {
    renderGroup([
      {
        title: 'Dashboard',
        url: '/dashboard',
        highlight: true,
        highlightColor: 'sunset',
      },
    ])
    const link = screen.getByRole('link', { name: 'Dashboard' })
    expect(link).toHaveAttribute('data-active')
    expect(link).toHaveClass(
      'bg-linear-to-r',
      'from-orange-400/15',
      'to-pink-500/15'
    )
  })

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

  test('renders every group immediately so all destinations stay discoverable', () => {
    renderGroup(
      [
        { title: 'Playground', url: '/playground', icon: User },
        { title: 'Wallet', url: '/wallet', icon: Wallet },
      ],
      { id: 'tools', title: 'Tools' }
    )

    expect(screen.getByRole('link', { name: 'Playground' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Wallet' })).toBeVisible()
  })

  test('keeps the active route visible inside its group', () => {
    renderGroup([{ title: 'Dashboard', url: '/dashboard', icon: User }], {
      id: 'general',
      title: 'Console',
    })

    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  })
})
