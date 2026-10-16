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
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkIsActive } from '@/components/layout/lib/url-utils'
import {
  parseSidebarModulesAdmin,
  serializeSidebarModulesAdmin,
} from '@/features/system-settings/maintenance/config'
import type { CustomPage } from '@/lib/custom-pages'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { useSidebarView } from '../use-sidebar-view'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useLocation: (options: {
    select: (location: { pathname: string }) => unknown
  }) => options.select({ pathname: '/finance/topups' }),
}))

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function sidebarFor(
  admin?: object,
  user?: object,
  canConfigure = true,
  customPages: CustomPage[] = [],
  role: number = ROLE.ADMIN
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    SidebarModulesAdmin: admin ? JSON.stringify(admin) : '',
  })
  client.setQueryData(['custom-pages'], customPages)
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'alice',
    role,
    permissions: { sidebar_settings: canConfigure },
    sidebar_modules: user ? JSON.stringify(user) : '',
  })
  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const result = renderHook(() => useSidebarView().navGroups, {
    wrapper: Wrapper,
  })
  return result
}

describe('security sidebar visibility', () => {
  it('old configurations show Security & Access immediately after Profile and keep API Keys', () => {
    const { result } = sidebarFor(
      { personal: { enabled: true, personal: true, topup: true } },
      { personal: { enabled: true, personal: true } }
    )
    const personalTitles =
      result.current
        .find((group) => group.id === 'personal')
        ?.items.map((item) => item.title) ?? []
    expect(personalTitles[personalTitles.indexOf('Profile') + 1]).toBe(
      'Security & Access'
    )
    expect(
      result.current
        .flatMap((group) => group.items)
        .some((item) => item.title === 'API Keys')
    ).toBe(true)
  })
  it.each([
    [{ personal: { enabled: true, security: false } }, undefined],
    [{ personal: { enabled: false } }, { personal: { security: true } }],
    [undefined, { personal: { enabled: true, security: false } }],
    [undefined, { personal: { enabled: false } }],
  ])(
    'admin or user disablement hides Security & Access (%j, %j)',
    (admin, user) => {
      const { result } = sidebarFor(admin, user)
      expect(
        result.current
          .flatMap((group) => group.items)
          .some((item) => item.title === 'Security & Access')
      ).toBe(false)
    }
  )
  it('users without sidebar configuration permission retain the admin view', () => {
    const { result } = sidebarFor(
      undefined,
      { personal: { security: false } },
      false
    )
    expect(
      result.current
        .flatMap((group) => group.items)
        .some((item) => item.title === 'Security & Access')
    ).toBe(true)
  })
})

describe('audit log sidebar entry', () => {
  it('admin settings default Audit Logs to visible and preserve its independent toggle when saved', () => {
    const config = parseSidebarModulesAdmin(
      '{"console":{"enabled":true,"log":true}}'
    )
    expect(config.console.audit).toBe(true)
    config.console.audit = false
    const saved = parseSidebarModulesAdmin(serializeSidebarModulesAdmin(config))
    const { result } = sidebarFor(saved)
    const titles = result.current
      .flatMap((group) => group.items)
      .map((item) => item.title)
    expect(titles).not.toContain('Audit Logs')
    expect(titles).toContain('Usage Logs')
  })

  it('legacy configurations show a separate Audit Logs link immediately after Usage Logs', () => {
    const { result } = sidebarFor(
      { console: { enabled: true, log: true } },
      { console: { enabled: true, log: true } }
    )
    const items =
      result.current.find((group) => group.id === 'general')?.items ?? []
    const usageIndex = items.findIndex((item) => item.title === 'Usage Logs')
    expect(items[usageIndex + 1]).toMatchObject({
      title: 'Audit Logs',
      url: '/usage-logs/audit',
    })
    const selected = items.filter((item) =>
      checkIsActive('/usage-logs/audit', item)
    )
    expect(selected.map((item) => item.title)).toEqual(['Audit Logs'])
  })

  it.each([
    [{ console: { enabled: true, audit: false } }, undefined],
    [{ console: { enabled: false } }, { console: { audit: true } }],
    [undefined, { console: { enabled: true, audit: false } }],
    [undefined, { console: { enabled: false } }],
  ])(
    'admin and personal visibility rules can hide Audit Logs (%j, %j)',
    (admin, user) => {
      const { result } = sidebarFor(admin, user)
      expect(
        result.current
          .flatMap((group) => group.items)
          .some((item) => item.title === 'Audit Logs')
      ).toBe(false)
    }
  )

  it('hiding Usage Logs does not hide the independently configured Audit Logs entry', () => {
    const { result } = sidebarFor({ console: { enabled: true, log: false } })
    const titles = result.current
      .flatMap((group) => group.items)
      .map((item) => item.title)
    expect(titles).not.toContain('Usage Logs')
    expect(titles).toContain('Audit Logs')
  })
})

describe('Custom pages sidebar group', () => {
  it('lists configured pages with their embed links and hides the group without pages', () => {
    const configured = sidebarFor(undefined, undefined, true, [
      {
        name: 'Status page',
        url: 'https://status.example.com',
        adminOnly: false,
        highlight: false,
      },
      {
        name: 'Monitoring',
        url: 'https://monitoring.example.com',
        adminOnly: true,
        highlight: true,
      },
    ])

    const group = configured.result.current.find(
      (navGroup) => navGroup.id === 'custom-pages'
    )
    expect(group?.title).toBe('Custom Pages')
    expect(group?.items.map((item) => item.title)).toEqual([
      'Status page',
      'Monitoring',
    ])
    expect(group?.items.map((item) => item.url)).toEqual([
      '/embed/status-page',
      '/embed/monitoring',
    ])
    expect(group?.items[1].requiredRole).toBe(ROLE.ADMIN)
    // Highlighted pages (the shop) keep the emphasized sidebar style.
    expect(group?.items.map((item) => item.highlight)).toEqual([false, true])

    const hidden = sidebarFor()
    expect(
      hidden.result.current.some((navGroup) => navGroup.id === 'custom-pages')
    ).toBe(false)
  })
})

describe('finance sidebar entries', () => {
  it('legacy configurations include manual credit in the finance group', () => {
    const { result } = sidebarFor({ admin: { enabled: true, finance: true } })
    const finance = result.current.find((group) => group.id === 'finance')
    expect(finance?.title).toBe('Finance Management')
    expect(
      finance?.items.map((item) => ({ title: item.title, url: item.url }))
    ).toEqual([
      { title: 'Manual credit', url: '/finance/credits' },
      { title: 'Top-up Orders', url: '/finance/topups' },
      { title: 'Redemption Ledger', url: '/finance/redemptions' },
      { title: 'Rebate Ledger', url: '/finance/rebates' },
      { title: 'Financial Operations', url: '/finance/operations' },
      { title: 'Refund center', url: '/finance/refunds' },
      { title: 'General Ledger', url: '/ledger' },
    ])
    const admin = result.current.find((group) => group.id === 'admin')
    expect(admin?.items.some((item) => item.url === '/channels')).toBe(true)
    expect(
      admin?.items.some((item) =>
        finance?.items.some((entry) => entry.url === item.url)
      )
    ).toBe(false)
  })

  it.each([
    ['/finance/credits', 'Manual credit'],
    ['/finance/topups', 'Top-up Orders'],
    ['/finance/redemptions', 'Redemption Ledger'],
    ['/finance/rebates', 'Rebate Ledger'],
    ['/finance/operations', 'Financial Operations'],
    ['/ledger', 'General Ledger'],
  ])('selects only the corresponding sidebar entry for %s', (url, title) => {
    const { result } = sidebarFor()
    const items = result.current.flatMap((group) => group.items)
    expect(
      items
        .filter((item) => checkIsActive(`${url}?page=2`, item))
        .map((item) => item.title)
    ).toEqual([title])
  })

  it('selects only the refund center for both refund workspaces', () => {
    const { result } = sidebarFor({ admin: { enabled: true, finance: true } })
    const items =
      result.current.find((group) => group.id === 'finance')?.items ?? []
    expect(
      items
        .filter((item) =>
          checkIsActive('/finance/refunds?request_id=incident', item)
        )
        .map((item) => item.title)
    ).toEqual(['Refund center'])
    expect(
      items
        .filter((item) => checkIsActive('/finance/cash-refunds', item))
        .map((item) => item.title)
    ).toEqual(['Refund center'])
  })

  it.each([
    [{ admin: { enabled: true, finance: false } }, undefined],
    [{ admin: { enabled: false } }, undefined],
    [undefined, { admin: { enabled: true, finance: false } }],
    [undefined, { admin: { enabled: false } }],
  ])(
    'finance visibility settings hide all ledger and refund links (%j, %j)',
    (admin, user) => {
      const { result } = sidebarFor(admin, user)
      expect(result.current.some((group) => group.id === 'finance')).toBe(false)
      expect(
        result.current
          .flatMap((group) => group.items)
          .some(
            (item) =>
              item.url?.startsWith('/finance/') || item.url === '/ledger'
          )
      ).toBe(false)
    }
  )

  it.each([ROLE.GUEST, ROLE.USER])(
    'hides the finance group and its links from role %s',
    (role) => {
      const { result } = sidebarFor(undefined, undefined, true, [], role)
      expect(
        result.current.some(
          (group) => group.id === 'finance' || group.id === 'admin'
        )
      ).toBe(false)
      expect(
        result.current
          .flatMap((group) => group.items)
          .some(
            (item) =>
              item.url?.startsWith('/finance/') || item.url === '/ledger'
          )
      ).toBe(false)
    }
  )
})
