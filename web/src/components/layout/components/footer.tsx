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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'

import { useContactSettings } from '@/features/contact/use-contact-settings'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

interface FooterLink {
  text: string
  href: string
}

interface FooterColumnProps {
  title: string
  links: FooterLink[]
}

interface FooterProps {
  logo?: string
  name?: string
  columns?: FooterColumnProps[]
  copyright?: string
  className?: string
}

const DEFAULT_FOOTER_COLUMNS: FooterColumnProps[] = [
  {
    title: 'Product',
    links: [
      { text: 'API Keys', href: '/keys' },
      { text: 'Models', href: '/pricing' },
    ],
  },
  {
    title: 'Resources',
    links: [{ text: 'About', href: '/about' }],
  },
]

function FooterLinkItem(props: { link: FooterLink }) {
  const { t } = useTranslation()
  const isExternal = props.link.href.startsWith('http')
  const label = t(props.link.text)

  if (isExternal) {
    return (
      <a
        href={props.link.href}
        target='_blank'
        rel='noopener noreferrer'
        className='text-muted-foreground hover:text-foreground text-sm transition-colors duration-200'
      >
        {label}
      </a>
    )
  }

  return (
    <Link
      to={props.link.href}
      className='text-muted-foreground hover:text-foreground text-sm transition-colors duration-200'
    >
      {label}
    </Link>
  )
}

// Renders User Agreement / Privacy Policy links inline with the parent's
// copyright row when either is configured in System Settings → Site. Emits
// fragmented siblings so the parent flex container's gap controls spacing.
function LegalLinks(props: { leadingSeparator?: boolean }) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const items: { key: string; label: string; href: string }[] = []
  if (status?.user_agreement_enabled) {
    items.push({
      key: 'user-agreement',
      label: t('User Agreement'),
      href: '/user-agreement',
    })
  }
  if (status?.privacy_policy_enabled) {
    items.push({
      key: 'privacy-policy',
      label: t('Privacy Policy'),
      href: '/privacy-policy',
    })
  }
  if (items.length === 0) {
    return null
  }
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {(props.leadingSeparator || index > 0) && (
            <span aria-hidden='true' className='text-muted-foreground/30'>
              ·
            </span>
          )}
          <Link
            to={item.href}
            className='hover:text-foreground transition-colors duration-200'
          >
            {item.label}
          </Link>
        </Fragment>
      ))}
    </>
  )
}

function ProjectSource() {
  const { t } = useTranslation()

  return (
    <div className='border-border/70 bg-background/70 flex items-center justify-between gap-5 rounded-2xl border px-4 py-3 shadow-xs backdrop-blur-sm'>
      <span className='text-muted-foreground text-[10px] font-bold tracking-[0.18em] uppercase'>
        {t('Open Source')}
      </span>
      <a
        href='https://github.com/QuantumNous/new-api'
        target='_blank'
        rel='noopener noreferrer'
        className='group text-foreground inline-flex items-center gap-1.5 text-sm font-black transition-colors hover:text-orange-600 dark:hover:text-orange-400'
      >
        {t('New API')}
        <ArrowUpRight
          className='size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5'
          aria-hidden='true'
        />
      </a>
    </div>
  )
}

function ContactInfo() {
  const { t } = useTranslation()
  const { qqGroupNumber, qqGroupURL } = useContactSettings()

  return (
    <div>
      <p className='text-muted-foreground mb-4 text-[10px] font-black tracking-[0.2em] uppercase'>
        {t('Contact Us')}
      </p>
      <ul className='space-y-3'>
        <li>
          <Link
            to='/contact'
            className='text-muted-foreground hover:text-foreground text-sm transition-colors duration-200'
          >
            {t('Contact Us')}
          </Link>
        </li>
        {qqGroupNumber ? (
          <li className='text-muted-foreground text-sm'>
            {t('QQ Group Number')}:{' '}
            <span className='text-foreground font-mono'>{qqGroupNumber}</span>
          </li>
        ) : null}
        {qqGroupURL ? (
          <li>
            <a
              href={qqGroupURL}
              target='_blank'
              rel='noopener noreferrer'
              className='text-muted-foreground hover:text-foreground text-sm transition-colors duration-200'
            >
              {t('Join QQ Group')}
            </a>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

export function Footer(props: FooterProps) {
  const { t } = useTranslation()
  const { footerHtml } = useSystemConfig()
  const brandName = props.name || 'KunRouter'
  const columns = props.columns ?? DEFAULT_FOOTER_COLUMNS
  const currentYear = new Date().getFullYear()

  return (
    <footer
      className={cn(
        'border-border/40 relative z-10 overflow-hidden border-t bg-[#faf5ef] dark:bg-[#120f0d]',
        props.className
      )}
    >
      <div
        aria-hidden='true'
        className='pointer-events-none absolute -top-24 right-[8%] size-72 rounded-full bg-orange-500/10 blur-3xl dark:bg-orange-500/[0.08]'
      />
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 [background-image:linear-gradient(90deg,rgba(193,84,27,0.045)_1px,transparent_1px),linear-gradient(rgba(193,84,27,0.045)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent_72%)] [background-size:36px_36px] dark:opacity-30'
      />

      <div className='relative mx-auto w-full max-w-6xl px-6 py-10 md:px-10 md:py-12'>
        <div className='flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-16'>
          <div className='max-w-sm'>
            <Link
              to='/'
              className='group inline-flex items-center gap-3 rounded-xl focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-4 focus-visible:outline-none'
            >
              {props.logo ? (
                <img
                  src={props.logo}
                  alt={brandName}
                  className='size-11 rounded-2xl object-contain'
                />
              ) : (
                <span className='relative grid size-11 place-items-center overflow-hidden rounded-2xl bg-[#1a1a1a] text-lg font-black text-white shadow-[0_10px_25px_-12px_rgba(0,0,0,0.8)] dark:bg-orange-500'>
                  <span
                    aria-hidden='true'
                    className='absolute -top-4 -right-3 size-9 rounded-full border-[6px] border-orange-500/35'
                  />
                  <span className='relative' aria-hidden='true'>
                    K
                  </span>
                </span>
              )}
              <span className='text-xl font-black tracking-[-0.035em]'>
                {brandName}
              </span>
            </Link>
            <p className='text-muted-foreground mt-4 max-w-xs text-sm leading-6'>
              {t('Powerful API Management Platform')}
            </p>
          </div>

          {footerHtml ? (
            <div className='flex max-w-xl flex-col items-start gap-5'>
              <div
                className='custom-footer text-muted-foreground text-sm leading-6'
                dangerouslySetInnerHTML={{ __html: footerHtml }}
              />
              <ContactInfo />
              <ProjectSource />
            </div>
          ) : (
            <div className='flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-12 lg:gap-16'>
              <nav
                aria-label={t('Product')}
                className='flex flex-wrap gap-10 sm:gap-14'
              >
                {columns.map((column) => (
                  <div key={column.title}>
                    <p className='text-muted-foreground mb-4 text-[10px] font-black tracking-[0.2em] uppercase'>
                      {t(column.title)}
                    </p>
                    <ul className='space-y-3'>
                      {column.links.map((link) => (
                        <li key={`${link.href}:${link.text}`}>
                          <FooterLinkItem link={link} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
              <ContactInfo />
              <ProjectSource />
            </div>
          )}
        </div>

        <div className='border-border/60 mt-10 flex flex-col gap-3 border-t pt-5 text-xs sm:flex-row sm:items-center sm:justify-between'>
          <div className='text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start'>
            <span className='tabular-nums'>
              &copy; {currentYear} {brandName}.{' '}
              {props.copyright ?? t('footer.defaultCopyright')}
            </span>
            <LegalLinks leadingSeparator />
          </div>
        </div>
      </div>
    </footer>
  )
}
