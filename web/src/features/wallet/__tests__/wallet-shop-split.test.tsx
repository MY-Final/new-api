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
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'

import { Wallet } from '../index'

const state = vi.hoisted(() => ({
  links: [] as Array<{
    name: string
    url: string
    adminOnly: boolean
    highlight: boolean
    inWallet: boolean
    slug: string
    href: string
  }>,
}))

vi.mock('@/components/layout', () => {
  const SectionPageLayout = Object.assign(
    (props: { children?: ReactNode }) => <div>{props.children}</div>,
    {
      Title: (props: { children?: ReactNode }) => <div>{props.children}</div>,
      Content: (props: { children?: ReactNode }) => <div>{props.children}</div>,
    }
  )
  return { SectionPageLayout }
})

vi.mock('@/features/custom-pages/hooks/use-custom-pages', () => ({
  useCustomPages: () => ({
    links: state.links,
    isLoading: false,
    isError: false,
  }),
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { price: 1 }, loading: false, error: null }),
}))

vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({
    currency: { quotaDisplayType: 'USD', usdExchangeRate: 1 },
  }),
}))

vi.mock('@/lib/api', () => ({
  getSelf: vi.fn().mockResolvedValue({ success: true, data: { quota: 100 } }),
}))

vi.mock('../hooks', () => ({
  useTopupInfo: () => ({
    topupInfo: {
      enable_redemption: true,
      topup_link: 'https://shop.example.com/card',
    },
    presetAmounts: [],
    loading: false,
  }),
  usePayment: () => ({
    amount: 0,
    calculating: false,
    processing: false,
    calculatePaymentAmount: vi.fn(),
    processPayment: vi.fn(),
  }),
  useAffiliate: () => ({
    affiliateLink: '',
    loading: false,
    transferQuota: vi.fn(),
    transferring: false,
  }),
  useRedemption: () => ({ redeeming: false, redeemCode: vi.fn() }),
  useCreemPayment: () => ({ processing: false, processCreemPayment: vi.fn() }),
  useWaffoPayment: () => ({ processing: false, processWaffoPayment: vi.fn() }),
  useWaffoPancakePayment: () => ({
    processing: false,
    processWaffoPancakePayment: vi.fn(),
  }),
}))

vi.mock('../components/wallet-stats-card', () => ({
  WalletStatsCard: () => <div>wallet-stats</div>,
}))
vi.mock('../components/wallet-funding-guide', () => ({
  WalletFundingGuide: () => <div>funding-guide</div>,
}))
vi.mock('../components/payment-recovery-notice', () => ({
  PaymentRecoveryNotice: () => <div>recovery-notice</div>,
}))
vi.mock('../components/recharge-form-card', () => ({
  RechargeFormCard: (props: { hideRedemption?: boolean }) => (
    <div>
      {props.hideRedemption
        ? 'recharge-without-redeem'
        : 'recharge-with-redeem'}
    </div>
  ),
}))
vi.mock('../components/subscription-plans-card', () => ({
  SubscriptionPlansCard: () => <div>subscription-card</div>,
}))
vi.mock('../components/affiliate-rewards-card', () => ({
  AffiliateRewardsCard: () => <div>affiliate-card</div>,
}))
vi.mock('../components/redemption-card', () => ({
  RedemptionCard: () => <div>redemption-card</div>,
}))
vi.mock('../components/wallet-shop-panel', () => ({
  WalletShopPanel: (props: { page: { name: string } }) => (
    <div>shop-panel:{props.page.name}</div>
  ),
}))
vi.mock('../components/dialogs/affiliate-invitees-dialog', () => ({
  AffiliateInviteesDialog: () => null,
}))
vi.mock('../components/dialogs/billing-history-dialog', () => ({
  BillingHistoryDialog: () => null,
}))
vi.mock('../components/dialogs/creem-confirm-dialog', () => ({
  CreemConfirmDialog: () => null,
}))
vi.mock('../components/dialogs/payment-confirm-dialog', () => ({
  PaymentConfirmDialog: () => null,
}))
vi.mock('../components/dialogs/transfer-dialog', () => ({
  TransferDialog: () => null,
}))

const i18n = createInstance()

beforeEach(async () => {
  state.links = []
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    nsSeparator: false,
    resources: { en },
    interpolation: { escapeValue: false },
  })
})

function renderWallet() {
  render(
    <I18nextProvider i18n={i18n}>
      <Wallet />
    </I18nextProvider>
  )
}

const shopLink = {
  name: 'Shop',
  url: 'https://pay.example.com/shop/demo',
  adminOnly: false,
  highlight: true,
  inWallet: true,
  slug: 'shop',
  href: '/embed/shop',
}

it('embeds the page marked for the wallet and moves redemption beside it', () => {
  state.links = [shopLink]
  renderWallet()

  expect(screen.getByText('shop-panel:Shop')).toBeVisible()
  expect(screen.getByText('redemption-card')).toBeVisible()
  expect(screen.getByText('recharge-without-redeem')).toBeVisible()
})

it('keeps the original wallet when no custom page targets it', () => {
  state.links = [
    { ...shopLink, name: 'Docs', highlight: false, inWallet: false },
  ]
  renderWallet()

  expect(screen.queryByText(/^shop-panel:/)).not.toBeInTheDocument()
  expect(screen.queryByText('redemption-card')).not.toBeInTheDocument()
  expect(screen.getByText('recharge-with-redeem')).toBeVisible()
})
