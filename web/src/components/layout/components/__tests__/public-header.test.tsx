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
import { fireEvent, render, screen } from '@testing-library/react'
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
    { href: '/dashboard', title: 'Dashboard' },
    { href: '/pricing', title: 'Model Square' },
  ],
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { user: null } }),
}))

describe('PublicHeader', () => {
  it('keeps desktop navigation labels intact and exposes a compact menu toggle', () => {
    render(<PublicHeader />)

    const desktopLink = screen.getAllByRole('link', {
      name: 'Dashboard',
    })[0]
    expect(desktopLink).toHaveClass('whitespace-nowrap')
    expect(desktopLink).not.toHaveClass('truncate')

    const toggle = screen.getByRole('button', {
      name: 'Toggle navigation menu',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', 'public-navigation-menu')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })
})
