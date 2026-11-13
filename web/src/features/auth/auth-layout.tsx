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
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { KunCodeCourt } from '@/components/kuncode-court'
import { LanguageSwitcher } from '@/components/language-switcher'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useContactSettings } from '@/features/contact/use-contact-settings'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

type AuthLayoutProps = {
  children: React.ReactNode
  showcase?: React.ReactNode
}

export function AuthLayout(props: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()
  const { qqGroupNumber, qqGroupURL } = useContactSettings()

  const content = (
    <div
      className={cn(
        'relative grid min-h-svh max-w-none',
        props.showcase && 'grid-rows-[auto_1fr]'
      )}
    >
      <header
        className={cn(
          'absolute top-4 left-4 z-10 sm:top-8 sm:left-8',
          props.showcase &&
            'relative inset-auto mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:inset-auto sm:px-10 sm:py-6'
        )}
      >
        <Link
          to='/'
          className='flex min-w-0 items-center gap-2.5 transition-opacity hover:opacity-80'
        >
          <div className='relative size-8 shrink-0'>
            {loading ? (
              <Skeleton className='absolute inset-0 rounded-full' />
            ) : (
              <img
                src={logo}
                alt={t('Logo')}
                className='size-8 rounded-full object-cover'
              />
            )}
          </div>
          {loading ? (
            <Skeleton className='h-6 w-24' />
          ) : (
            <h1 className='truncate text-xl font-semibold tracking-tight'>
              {systemName}
            </h1>
          )}
        </Link>
        {props.showcase && (
          <div className='flex shrink-0 items-center gap-1 sm:gap-2'>
            <Button
              variant='ghost'
              size='sm'
              className='text-muted-foreground mr-2 hidden gap-2 sm:inline-flex'
              render={<Link to='/' />}
            >
              <ArrowLeft className='size-3.5' aria-hidden='true' />
              {t('Back to Home')}
            </Button>
            <LanguageSwitcher />
            <ThemeSwitch />
          </div>
        )}
      </header>
      <main
        className={cn(
          'container flex items-center pt-16 sm:pt-0',
          props.showcase &&
            'mx-auto grid w-full max-w-7xl items-center gap-10 px-5 py-8 sm:px-10 sm:py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14 lg:pt-2 lg:pb-8'
        )}
      >
        {props.showcase && (
          <aside className='hidden min-w-0 self-stretch lg:flex'>
            {props.showcase}
          </aside>
        )}
        <div
          className={cn(
            'mx-auto flex w-full flex-col justify-center space-y-2 px-4 py-8 sm:w-[480px] sm:p-8',
            props.showcase &&
              'max-w-[460px] min-w-0 gap-4 space-y-0 px-0 py-0 sm:w-full sm:p-0'
          )}
        >
          {props.children}
          <div className='text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pt-2 text-center text-xs'>
            <span>{t('Contact Us')}:</span>
            <Link
              to='/contact'
              className='hover:text-foreground underline underline-offset-4'
            >
              {t('Contact Us')}
            </Link>
            {qqGroupNumber ? (
              <span>
                {t('QQ Group Number')}:{' '}
                <span className='text-foreground font-mono'>
                  {qqGroupNumber}
                </span>
              </span>
            ) : null}
            {qqGroupURL ? (
              <a
                href={qqGroupURL}
                target='_blank'
                rel='noopener noreferrer'
                className='hover:text-foreground underline underline-offset-4'
              >
                {t('Join QQ Group')}
              </a>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )

  return props.showcase ? <KunCodeCourt>{content}</KunCodeCourt> : content
}
