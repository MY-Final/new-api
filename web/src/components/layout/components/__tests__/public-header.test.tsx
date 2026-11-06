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
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PublicHeader } from '../public-header'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode
    to: string
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: '/' } }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/dialog', () => ({
  Dialog: () => null,
}))

vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => <span>Language</span>,
}))

vi.mock('@/components/notification-popover', () => ({
  NotificationPopover: () => null,
}))

vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => null,
}))

vi.mock('@/components/theme-switch', () => ({
  ThemeSwitch: () => null,
}))

vi.mock('@/features/system-update/system-update-action', () => ({
  SystemUpdateAction: () => null,
}))

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({
    announcements: [],
    activeTab: 'notifications',
    isAnnouncementRead: vi.fn(),
    loading: false,
    markAllAnnouncementsAsRead: vi.fn(),
    markAnnouncementRead: vi.fn(),
    notice: '',
    popoverOpen: false,
    setActiveTab: vi.fn(),
    setPopoverOpen: vi.fn(),
    unreadAnnouncementsCount: 0,
    unreadCount: 0,
  }),
}))

vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({
    loading: false,
    logo: '',
    logoLoaded: true,
    systemName: 'New API',
  }),
}))

vi.mock('@/hooks/use-top-nav-links', () => ({
  useTopNavLinks: () => [
    { href: '/', title: 'Home', section: 'primary' },
    { href: '/dashboard', title: 'Dashboard', section: 'primary' },
    { href: '/pricing', title: 'Model Square', section: 'product' },
    { href: '/rankings', title: 'Rankings', section: 'product' },
    { href: '/about', title: 'About', section: 'resources' },
    {
      href: 'https://help.example.com',
      title: 'Help',
      external: true,
      section: 'custom',
    },
  ],
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { user: null } }),
}))

describe('PublicHeader', () => {
  it('keeps desktop navigation labels intact and exposes a compact menu toggle', () => {
    render(<PublicHeader />)

    const desktopLink = screen.getByRole('link', {
      name: 'Dashboard',
    })
    expect(desktopLink).toHaveClass('whitespace-nowrap')
    expect(desktopLink).not.toHaveClass('truncate')
    expect(screen.getByRole('button', { name: 'Product' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Resources' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'More' })).toBeVisible()
    expect(
      screen.queryByRole('link', { name: 'Model Square' })
    ).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', {
      name: 'Toggle navigation menu',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'public-navigation-menu')
    expect(document.querySelector('#public-navigation-menu')).toHaveAttribute(
      'aria-hidden',
      'true'
    )

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const mobileNavigation = document.querySelector('#public-navigation-menu')
    expect(mobileNavigation).toHaveAttribute('aria-hidden', 'false')
    expect(
      within(mobileNavigation as HTMLElement).getByRole('link', {
        name: 'Model Square',
      })
    ).toBeVisible()
    expect(
      within(mobileNavigation as HTMLElement).getByText('Product')
    ).toBeVisible()
    expect(
      within(mobileNavigation as HTMLElement).getByText('Resources')
    ).toBeVisible()
  })

  it('opens grouped desktop navigation without flattening the primary links', async () => {
    const user = userEvent.setup()
    render(<PublicHeader />)

    await user.click(screen.getByRole('button', { name: 'Product' }))

    expect(
      await screen.findByRole('menuitem', { name: 'Model Square' })
    ).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Rankings' })).toBeVisible()
  })
})
