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
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Box,
  Brain,
  ClipboardList,
  CreditCard,
  CircleDollarSign,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  Image as ImageIcon,
  Key,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  PanelsTopLeft,
  PlugZap,
  Radio,
  RotateCcw,
  ServerCog,
  Settings,
  ShieldCheck,
  Ticket,
  User,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarData } from '@/components/layout/types'
import { useCustomPages } from '@/features/custom-pages/hooks/use-custom-pages'
import { useTicketUnread } from '@/features/tickets/hooks/use-ticket-unread'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(): SidebarData {
  const { t, i18n } = useTranslation()
  const { links: customPageLinks } = useCustomPages()
  const tickets = useTicketUnread()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // A page embedded beside the wallet already has a permanent entry point;
  // repeating it in the sidebar only splits where users look for the shop.
  const sidebarCustomPageLinks = customPageLinks.filter(
    (page) => !page.inWallet
  )

  return {
    navGroups: [
      {
        id: 'chat',
        title: t('Chat'),
        items: [
          {
            title: t('Playground'),
            url: '/playground',
            icon: FlaskConical,
          },
          {
            title: t('Intelligence Test'),
            url: '/intelligence-test',
            icon: Brain,
          },
          {
            title: t('Canvas'),
            url: '/canvas',
            icon: ImageIcon,
          },
          {
            title: t('Drawing Records'),
            url: '/canvas-history',
            icon: History,
          },
          {
            title: t('Chat'),
            icon: MessageSquare,
            type: 'chat-presets',
          },
        ],
      },
      {
        id: 'general',
        title: t('General'),
        items: [
          {
            title: t('Overview'),
            url: '/dashboard/overview',
            icon: Activity,
          },
          {
            title: t('Dashboard'),
            url: '/dashboard/models',
            icon: LayoutDashboard,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Usage Logs'),
            url: '/usage-logs/common',
            icon: FileText,
          },
          {
            title: t('Audit Logs'),
            url: '/usage-logs/audit',
            icon: ClipboardList,
          },
          {
            title: t('Error Requests'),
            url: '/error-requests',
            icon: AlertTriangle,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Task Logs'),
            url: '/usage-logs/task',
            activeUrls: ['/usage-logs/drawing'],
            configUrls: ['/usage-logs/drawing', '/usage-logs/task'],
            icon: ListTodo,
          },
        ],
      },
      {
        id: 'personal',
        title: t('Personal'),
        items: [
          {
            title: t('My tickets'),
            url: '/tickets',
            icon: MessageSquare,
            badge:
              tickets.personal > 0
                ? formatNumber(Math.min(tickets.personal, 99), locale)
                : undefined,
          },
          {
            title: t('Wallet'),
            url: '/wallet',
            icon: Wallet,
            highlight: true,
          },
          {
            title: t('Usage Statistics'),
            url: '/usage',
            icon: BarChart3,
          },
          {
            title: t('Affiliate Rebates'),
            url: '/affiliate-rebates',
            icon: CircleDollarSign,
          },
          {
            title: t('Profile'),
            url: '/profile',
            icon: User,
          },
          {
            title: t('Security & Access'),
            url: '/security',
            icon: ShieldCheck,
          },
        ],
      },
      ...(sidebarCustomPageLinks.length > 0
        ? [
            {
              id: 'custom-pages',
              title: t('Custom Pages'),
              items: sidebarCustomPageLinks.map((page) => ({
                title: t(page.name),
                url: page.href,
                icon: PanelsTopLeft,
                highlight: page.highlight,
                highlightColor: page.highlightColor,
                // The API already hides admin-only pages from other roles;
                // requiredRole keeps a stale cache from leaking the entry.
                ...(page.adminOnly ? { requiredRole: ROLE.ADMIN } : {}),
              })),
            },
          ]
        : []),
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          ...(tickets.canRead
            ? [
                {
                  title: t('Ticket Management'),
                  url: '/ticket-management',
                  icon: ClipboardList,
                  badge:
                    tickets.staff > 0
                      ? formatNumber(Math.min(tickets.staff, 99), locale)
                      : undefined,
                },
              ]
            : []),
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('Operations Monitoring'),
            url: '/monitoring',
            icon: HeartPulse,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            title: t('Subscriptions'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          {
            title: t('System Info'),
            url: '/system-info',
            icon: ServerCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Task Plugins'),
            url: '/task-plugins',
            icon: PlugZap,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
            requiredRole: ROLE.SUPER_ADMIN,
          },
        ],
      },
      {
        id: 'finance',
        title: t('Finance Management'),
        items: [
          {
            title: t('Manual credit'),
            url: '/finance/credits',
            configUrls: ['/finance'],
            icon: Wallet,
          },
          {
            title: t('Top-up Orders'),
            url: '/finance/topups',
            configUrls: ['/finance'],
            icon: CreditCard,
          },
          {
            title: t('Redemption Ledger'),
            url: '/finance/redemptions',
            configUrls: ['/finance'],
            icon: Ticket,
          },
          {
            title: t('Rebate Ledger'),
            url: '/finance/rebates',
            configUrls: ['/finance'],
            icon: CircleDollarSign,
          },
          {
            title: t('Financial Operations'),
            url: '/finance/operations',
            configUrls: ['/finance'],
            icon: ClipboardList,
          },
          {
            title: t('Refund center'),
            url: '/finance/refunds',
            activeUrls: ['/finance/refunds', '/finance/cash-refunds'],
            configUrls: ['/finance'],
            icon: RotateCcw,
          },
          {
            title: t('General Ledger'),
            url: '/ledger',
            configUrls: ['/finance'],
            icon: BookOpen,
          },
        ],
      },
    ],
  }
}
