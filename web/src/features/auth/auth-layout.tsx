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
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useContactSettings } from '@/features/contact/use-contact-settings'
import { useSystemConfig } from '@/hooks/use-system-config'

type AuthLayoutProps = {
  children: React.ReactNode
}

export function AuthLayout(props: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()
  const { qqGroupNumber, qqGroupURL } = useContactSettings()

  return (
    <div className='bg-background text-foreground flex min-h-svh items-center justify-center px-6 py-12 sm:px-8'>
      <main className='w-full max-w-sm min-w-0'>
        <header className='mb-8 flex justify-center'>
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
        </header>
        {props.children}
        <div className='text-muted-foreground mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs'>
          <Link
            to='/contact'
            className='hover:text-foreground underline underline-offset-4'
          >
            {t('Contact Us')}
          </Link>
          {qqGroupNumber ? (
            <span>
              {t('QQ Group Number')}:{' '}
              <span className='text-foreground font-mono'>{qqGroupNumber}</span>
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
      </main>
    </div>
  )
}
