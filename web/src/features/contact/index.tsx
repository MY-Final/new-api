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
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'

import { ContactDetails } from './contact-details'

export function Contact() {
  const { t } = useTranslation()

  return (
    <PublicLayout>
      <div className='mx-auto max-w-3xl'>
        <div className='mb-8 text-center'>
          <h1 className='text-3xl font-bold tracking-tight'>
            {t('Contact Us')}
          </h1>
          <p className='text-muted-foreground mt-2 text-sm'>
            {t('Questions, announcements and communication are welcome.')}
          </p>
        </div>

        <div className='border-border bg-card rounded-2xl border p-5 shadow-sm sm:p-8'>
          <ContactDetails />
        </div>
      </div>
    </PublicLayout>
  )
}
