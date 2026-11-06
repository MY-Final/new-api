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
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { isTopNavLinkActive } from '../lib/url-utils'
import type { TopNavLink } from '../types'

interface PublicNavigationProps {
  links: TopNavLink[]
  pathname: string
  onLinkClick?: (event: MouseEvent<HTMLElement>, link: TopNavLink) => void
  className?: string
}

const menuSections = [
  { id: 'product', label: 'Product' },
  { id: 'resources', label: 'Resources' },
  { id: 'custom', label: 'More' },
] as const

function PublicNavDropdown(props: {
  label: string
  links: TopNavLink[]
  pathname: string
  onLinkClick?: (event: MouseEvent<HTMLElement>, link: TopNavLink) => void
}) {
  const { t } = useTranslation()
  const active = props.links.some(
    (link) => !link.external && isTopNavLinkActive(props.pathname, link.href)
  )

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='sm'
            data-active={active || undefined}
            className='text-muted-foreground hover:bg-muted/60 hover:text-foreground data-active:bg-muted data-active:text-foreground h-8 gap-1.5 rounded-lg px-3 text-sm font-medium [&[aria-expanded=true]_.nav-chevron]:rotate-[225deg]'
          />
        }
      >
        {t(props.label)}
        <span
          className='nav-chevron size-1.5 -translate-y-0.5 rotate-45 border-r border-b border-current transition-transform duration-200'
          aria-hidden='true'
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' sideOffset={8} className='w-56 p-1.5'>
        {props.links.map((link) => {
          const activeLink =
            !link.external && isTopNavLinkActive(props.pathname, link.href)
          if (link.external) {
            return (
              <DropdownMenuItem
                key={`${link.title}:${link.href}`}
                disabled={link.disabled}
                render={
                  <a
                    href={link.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-disabled={link.disabled}
                  />
                }
                onClick={(event) => props.onLinkClick?.(event, link)}
                className='px-2 py-2'
              >
                {t(link.title)}
              </DropdownMenuItem>
            )
          }
          return (
            <DropdownMenuItem
              key={`${link.title}:${link.href}`}
              disabled={link.disabled}
              render={
                <Link
                  to={link.href}
                  disabled={link.disabled}
                  aria-current={activeLink ? 'page' : undefined}
                />
              }
              onClick={(event) => props.onLinkClick?.(event, link)}
              className={cn(
                'px-2 py-2',
                activeLink && 'bg-muted text-foreground'
              )}
            >
              {t(link.title)}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Desktop public navigation. Primary destinations stay visible while related
 * destinations are grouped to keep the header compact.
 */
export function PublicNavigation(props: PublicNavigationProps) {
  const { t } = useTranslation()
  const primaryLinks = props.links.filter(
    (link) => !link.section || link.section === 'primary'
  )

  return (
    <nav
      aria-label={t('Header navigation')}
      className={cn('hidden items-center gap-0.5 xl:flex', props.className)}
    >
      {primaryLinks.map((link) => {
        const active =
          !link.external && isTopNavLinkActive(props.pathname, link.href)
        const className = cn(
          'text-muted-foreground hover:bg-muted/60 hover:text-foreground inline-flex h-8 shrink-0 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors',
          active && 'bg-muted text-foreground'
        )

        if (link.external) {
          return (
            <a
              key={`${link.title}:${link.href}`}
              href={link.href}
              target='_blank'
              rel='noopener noreferrer'
              aria-disabled={link.disabled}
              tabIndex={link.disabled ? -1 : undefined}
              onClick={(event) => props.onLinkClick?.(event, link)}
              className={cn(
                className,
                link.disabled && 'pointer-events-none opacity-50'
              )}
            >
              {t(link.title)}
            </a>
          )
        }

        return (
          <Link
            key={`${link.title}:${link.href}`}
            to={link.href}
            disabled={link.disabled}
            aria-current={active ? 'page' : undefined}
            onClick={(event) => props.onLinkClick?.(event, link)}
            className={cn(
              className,
              link.disabled && 'pointer-events-none opacity-50'
            )}
          >
            {t(link.title)}
          </Link>
        )
      })}

      {menuSections.map((section) => {
        const links = props.links.filter((link) => link.section === section.id)
        if (links.length === 0) return null
        return (
          <PublicNavDropdown
            key={section.id}
            label={section.label}
            links={links}
            pathname={props.pathname}
            onLinkClick={props.onLinkClick}
          />
        )
      })}
    </nav>
  )
}
