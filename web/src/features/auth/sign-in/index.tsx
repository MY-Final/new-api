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
import { Link, useSearch } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { SignInShowcase } from './components/sign-in-showcase'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()

  return (
    <AuthLayout showcase={<SignInShowcase />}>
      <div className='border-border/70 bg-card/95 relative w-full min-w-0 rounded-3xl border p-5 shadow-[0_16px_64px_-24px_rgba(0,0,0,0.18)] sm:p-7 dark:shadow-[0_16px_64px_-24px_rgba(0,0,0,0.5)]'>
        <div className='bg-primary text-primary-foreground mb-6 flex size-11 items-center justify-center rounded-2xl shadow-sm'>
          <ArrowUpRight className='size-5' aria-hidden='true' />
        </div>
        <div className='mb-6 space-y-2.5'>
          <p className='text-muted-foreground text-xs font-medium tracking-wide'>
            {t('Sign in')}
          </p>
          <h2 className='text-3xl font-semibold tracking-tight'>
            {t('Welcome back!')}
          </h2>
          <p className='text-muted-foreground text-sm leading-6'>
            {t('Sign in to continue creating.')}
          </p>
        </div>

        <UserAuthForm
          redirectTo={redirect}
          className='min-w-0 gap-5 [&_button[type=submit]]:h-12 [&_button[type=submit]]:rounded-xl [&_input]:h-11 [&_input]:rounded-xl'
        />

        {!status?.self_use_mode_enabled &&
          status?.register_enabled !== false && (
            <p className='border-border/70 text-muted-foreground mt-6 border-t pt-5 text-center text-sm leading-6'>
              {t("Don't have an account?")}{' '}
              <Link
                to='/sign-up'
                search={redirect ? { redirect } : {}}
                className='text-foreground hover:text-primary font-semibold underline underline-offset-4'
              >
                {t('Sign up')}
              </Link>
            </p>
          )}

        <TermsFooter
          variant='sign-in'
          status={status}
          className='mt-5 text-center leading-5'
        />
      </div>
    </AuthLayout>
  )
}
