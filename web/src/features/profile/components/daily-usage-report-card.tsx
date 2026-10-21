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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SettingsControlChildren,
  SettingsControlGroup,
  SettingsSwitchField,
} from '@/features/system-settings/components/settings-form-layout'
import { handleServerError } from '@/lib/handle-server-error'

import { getUsageReportSettings, updateUsageReportSettings } from '../api'
import type { UsageReportSettings } from '../types'

const USAGE_REPORT_QUERY_KEY = ['user', 'usage-report-settings'] as const

/**
 * Daily usage summary subscription. It owns its own query and mutation so the
 * switch is stored independently from the general notification settings and is
 * never overwritten by the save button of that form.
 */
export function DailyUsageReportCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null)

  const settingsQuery = useQuery({
    queryKey: USAGE_REPORT_QUERY_KEY,
    queryFn: async () => {
      const response = await getUsageReportSettings()
      if (
        !response.success ||
        !response.data ||
        typeof response.data.enabled !== 'boolean'
      ) {
        throw new Error(response.message || 'Failed to load settings')
      }
      return response.data
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await updateUsageReportSettings(enabled)
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to update settings')
      }
      return response.data
    },
    onSuccess: (data: UsageReportSettings) => {
      queryClient.setQueryData(USAGE_REPORT_QUERY_KEY, data)
      setPendingEnabled(null)
    },
    onError: (error) => {
      // Keep the server state: no optimistic value survives a failed save.
      setPendingEnabled(null)
      handleServerError(error, t('Failed to update settings'))
    },
  })

  if (settingsQuery.isLoading) {
    return <Skeleton className='h-28 w-full' />
  }

  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <SettingsControlGroup>
        <p className='text-muted-foreground text-sm'>
          {t('Failed to load daily usage summary settings')}
        </p>
        <Button
          size='sm'
          variant='outline'
          onClick={() => settingsQuery.refetch()}
        >
          {t('Retry')}
        </Button>
      </SettingsControlGroup>
    )
  }

  const settings = settingsQuery.data
  const enabled = pendingEnabled ?? settings.enabled
  const recipients = Array.isArray(settings.recipients)
    ? settings.recipients
    : []
  const deliveryReady = settings.delivery_ready && recipients.length > 0

  return (
    <SettingsControlGroup>
      <SettingsSwitchField
        controlId='dailyUsageReport'
        label={t('Daily usage summary')}
        description={t(
          'Beijing time 22:00 · Today 00:00–22:00 · Grouped by group'
        )}
        checked={enabled}
        disabled={mutation.isPending}
        onCheckedChange={(checked) => {
          setPendingEnabled(checked)
          mutation.mutate(checked)
        }}
      />
      <SettingsControlChildren className='space-y-1.5 pb-1'>
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {t(
            'Enabled by default. No email is sent on days without requests; when there is usage, the report is sent to your verified email addresses and includes requests, quota and tokens. Usage after 22:00 is available in the console.'
          )}
        </p>

        {deliveryReady ? (
          <p className='text-muted-foreground text-xs'>
            {t('Recipients: {{emails}}', {
              emails: recipients.join(', '),
            })}
          </p>
        ) : (
          <div className='space-y-2'>
            <p className='text-xs text-amber-600 dark:text-amber-400'>
              {t(
                'No verified email address yet. Bind and verify an email to receive the report.'
              )}
            </p>
            <Button
              size='sm'
              variant='outline'
              render={<Link to='/security' />}
            >
              {t('Bind email')}
            </Button>
          </div>
        )}

        {mutation.isError && (
          <p className='text-destructive text-xs'>
            {t('Save failed, the previous setting is kept')}
          </p>
        )}
      </SettingsControlChildren>
    </SettingsControlGroup>
  )
}
