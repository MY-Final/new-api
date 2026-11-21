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
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()

  return (
    <AuthLayout>
      <div data-slot='auth-card' className='w-full min-w-0'>
        <div className='mb-8 space-y-2 text-center'>
          <h2 className='text-2xl font-semibold tracking-tight'>
            {t('Welcome back')}
          </h2>
          <p className='text-muted-foreground text-sm leading-6'>
            {t('Sign in to continue creating')}
          </p>
        </div>

        <UserAuthForm
          redirectTo={redirect}
          className='min-w-0 gap-5 [&_button[type=submit]]:h-11 [&_input]:h-11'
        />

        {!status?.self_use_mode_enabled &&
          status?.register_enabled !== false && (
            <p className='text-muted-foreground mt-6 text-center text-sm leading-6'>
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
