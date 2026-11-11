import { useQuery } from '@tanstack/react-query'
import { CreditCard } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  getAdminPlans,
  getUserSubscriptions,
} from '@/features/subscriptions/api'
import { UserSubscriptionsDialog } from '@/features/subscriptions/components/dialogs/user-subscriptions-dialog'
import { formatWindowDuration } from '@/features/subscriptions/lib/format'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import type { UserInfo } from '../../types'

function SubscriptionField(props: { label: string; children: ReactNode }) {
  return (
    <div className='min-w-0 space-y-1'>
      <dt className='text-muted-foreground text-xs font-medium'>
        {props.label}
      </dt>
      <dd className='text-sm font-semibold break-words'>{props.children}</dd>
    </div>
  )
}

export function UserInfoSubscriptions(props: { user: UserInfo }) {
  const { t } = useTranslation()
  const [manageOpen, setManageOpen] = useState(false)
  const subscriptionsQuery = useQuery({
    queryKey: ['usage-logs', 'user-subscriptions', props.user.id],
    queryFn: async () => {
      const [subscriptionsResponse, plansResponse] = await Promise.all([
        getUserSubscriptions(props.user.id),
        getAdminPlans(),
      ])
      const subscriptions = requireServerSuccess(subscriptionsResponse).data
      const plans = requireServerSuccess(plansResponse).data
      if (!Array.isArray(subscriptions) || !Array.isArray(plans)) {
        throw new Error('Invalid subscription response')
      }
      const now = Date.now() / 1000
      return {
        subscriptions: subscriptions
          .map((record) => record.subscription)
          .filter(
            (subscription) =>
              subscription.status === 'active' && subscription.end_time > now
          ),
        plans,
      }
    },
    meta: { errorToast: false },
  })

  return (
    <Card size='sm'>
      <CardHeader className='border-b'>
        <CardTitle className='flex items-center gap-2'>
          <CreditCard className='text-muted-foreground size-4' />
          {t('Current Subscriptions')}
        </CardTitle>
        <CardAction>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setManageOpen(true)}
          >
            {t('Manage Subscriptions')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {subscriptionsQuery.isFetching && (
          <div role='status'>
            <LoadingState inline size='sm' message={t('Loading...')} />
          </div>
        )}
        {!subscriptionsQuery.isFetching && subscriptionsQuery.isError && (
          <ErrorState
            title={t('Failed to load')}
            description={getServerErrorMessage(subscriptionsQuery.error)}
            onRetry={() => void subscriptionsQuery.refetch()}
            className='min-h-0 px-0 py-2'
          />
        )}
        {!subscriptionsQuery.isFetching &&
          !subscriptionsQuery.isError &&
          subscriptionsQuery.data?.subscriptions.length === 0 && (
            <EmptyState
              icon={CreditCard}
              title={t('No active subscriptions')}
              className='min-h-0 px-0 py-2'
            />
          )}
        {!subscriptionsQuery.isFetching &&
          !subscriptionsQuery.isError &&
          subscriptionsQuery.data?.subscriptions.map((subscription) => {
            const plan = subscriptionsQuery.data.plans.find(
              (record) => record.plan.id === subscription.plan_id
            )?.plan
            const windowsUnavailable = subscription.quota_windows === null
            const windows = subscription.quota_windows ?? []
            const remaining = Math.max(
              0,
              subscription.amount_total - subscription.amount_used
            )
            return (
              <section
                key={subscription.id}
                aria-label={`${plan?.title || `#${subscription.plan_id}`} · ${t('Subscription')} #${subscription.id}`}
                className='space-y-3 rounded-lg border p-3 not-first:mt-3'
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='min-w-0 text-sm font-semibold break-words'>
                    {plan?.title || `#${subscription.plan_id}`}
                  </span>
                  <StatusBadge
                    label={t('Active')}
                    variant='success'
                    copyable={false}
                  />
                </div>
                <dl className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                  <SubscriptionField label={t('Expiration Time')}>
                    {formatTimestampToDate(subscription.end_time)}
                  </SubscriptionField>
                  {!windowsUnavailable &&
                    windows.length === 0 &&
                    subscription.amount_total > 0 && (
                      <>
                        <SubscriptionField label={t('Used Quota')}>
                          {formatQuota(subscription.amount_used)} /{' '}
                          {formatQuota(subscription.amount_total)}
                        </SubscriptionField>
                        <SubscriptionField label={t('Remaining')}>
                          {formatQuota(remaining)}
                        </SubscriptionField>
                      </>
                    )}
                  {!windowsUnavailable &&
                    windows.length === 0 &&
                    subscription.amount_total <= 0 && (
                      <SubscriptionField label={t('Total Quota')}>
                        {t('Unlimited')}
                      </SubscriptionField>
                    )}
                  {!windowsUnavailable &&
                    windows.length === 0 &&
                    (subscription.next_reset_time ?? 0) > 0 && (
                      <SubscriptionField label={t('Next reset')}>
                        {formatTimestampToDate(subscription.next_reset_time)}
                      </SubscriptionField>
                    )}
                </dl>
                {windowsUnavailable && (
                  <ErrorState
                    title={t('Failed to load')}
                    onRetry={() => void subscriptionsQuery.refetch()}
                    className='min-h-0 px-0 py-2'
                  />
                )}
                {windows.length > 0 && (
                  <div className='grid gap-2 sm:grid-cols-2'>
                    {windows.map((window) => (
                      <div
                        key={window.window_seconds}
                        className='bg-muted/40 rounded-md p-2 text-sm'
                      >
                        <div className='flex flex-wrap justify-between gap-1'>
                          <span className='font-medium'>
                            {formatWindowDuration(window.window_seconds, t)}
                          </span>
                          <span className='text-muted-foreground tabular-nums'>
                            {t('Used')} {formatQuota(window.used)}/
                            {formatQuota(window.quota_limit)} · {t('Remaining')}{' '}
                            {formatQuota(window.remaining)}
                          </span>
                        </div>
                        {window.next_release_at > 0 && (
                          <div className='text-muted-foreground mt-1 text-xs'>
                            {t('Next release')}:{' '}
                            {formatTimestampToDate(window.next_release_at)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
      </CardContent>
      <UserSubscriptionsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        user={{ id: props.user.id, username: props.user.username }}
        onSuccess={() => void subscriptionsQuery.refetch()}
      />
    </Card>
  )
}
