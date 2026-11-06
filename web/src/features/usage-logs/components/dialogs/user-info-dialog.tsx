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
import {
  Loader2,
  Link2,
  UserRound,
  UserRoundPlus,
  WalletCards,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatCompactNumber,
  formatNumber,
  formatQuota,
  formatTimestampToDate,
} from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getRoleLabelKey } from '@/lib/roles'

import { getUserInfo } from '../../api'
import type { UserInfo } from '../../types'

interface UserInfoDialogProps {
  userId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function InfoItem(props: { label: string; children: ReactNode }) {
  return (
    <div className='min-w-0 space-y-1'>
      <dt className='text-muted-foreground text-xs font-medium'>
        {props.label}
      </dt>
      <dd className='text-sm font-semibold break-words'>{props.children}</dd>
    </div>
  )
}

function InfoCard(props: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <Card size='sm'>
      <CardHeader className='border-b'>
        <CardTitle className='flex items-center gap-2'>
          {props.icon}
          {props.title}
        </CardTitle>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  )
}

export function UserInfoDialog({
  userId,
  open,
  onOpenChange,
}: UserInfoDialogProps) {
  const { t } = useTranslation()
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchUserInfo = useCallback(
    async (id: number) => {
      setIsLoading(true)
      try {
        const result = await getUserInfo(id)
        if (result.success) {
          setUserInfo(result.data || null)
        } else {
          handleServerError(result, t('Failed to fetch user information'))
        }
      } catch (error) {
        handleServerError(error, t('Failed to fetch user information'))
      } finally {
        setIsLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (open && userId) {
      setUserInfo(null)
      fetchUserInfo(userId)
    }
  }, [open, userId, fetchUserInfo])

  const inviterId = userInfo?.inviter_id ?? 0
  let statusLabel = t('Enabled')
  let statusVariant: StatusVariant = 'success'
  if (userInfo?.status === 2) {
    statusLabel = t('Disabled')
    statusVariant = 'neutral'
  } else if (userInfo?.status === 3) {
    statusLabel = t('Deleted')
    statusVariant = 'danger'
  }
  const bindings = userInfo
    ? [
        { label: t('GitHub'), value: userInfo.github_id },
        { label: t('Discord'), value: userInfo.discord_id },
        { label: t('OIDC'), value: userInfo.oidc_id },
        { label: t('WeChat'), value: userInfo.wechat_id },
        { label: t('Telegram'), value: userInfo.telegram_id },
        { label: t('LinuxDO'), value: userInfo.linux_do_id },
      ].filter((binding) => Boolean(binding.value))
    : []

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('User Information')}
      description={t(
        'View detailed information about this user including balance, usage statistics, and invitation details.'
      )}
      contentClassName='sm:max-w-4xl'
      contentHeight='min(78dvh, 760px)'
      bodyClassName='space-y-4'
    >
      {isLoading && (
        <div className='flex items-center justify-center py-8'>
          <Loader2 className='text-muted-foreground size-6 animate-spin' />
        </div>
      )}
      {!isLoading && userInfo && (
        <div className='space-y-4'>
          <div className='bg-muted/40 flex flex-col items-start gap-3 rounded-xl border p-4 sm:flex-row sm:justify-between'>
            <div className='min-w-0'>
              <div className='truncate text-lg font-semibold'>
                {userInfo.display_name || userInfo.username}
              </div>
              <div className='text-muted-foreground mt-1 text-sm'>
                @{userInfo.username} · {t('User ID')} {userInfo.id}
              </div>
            </div>
            <div className='flex flex-wrap gap-2 sm:justify-end'>
              <StatusBadge
                label={statusLabel}
                variant={statusVariant}
                copyable={false}
              />
              <StatusBadge
                label={t(getRoleLabelKey(userInfo.role))}
                variant='info'
                copyable={false}
              />
            </div>
          </div>

          <div className='grid gap-4 lg:grid-cols-2'>
            <InfoCard
              title={t('Account')}
              icon={<UserRound className='text-muted-foreground size-4' />}
            >
              <dl className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2'>
                <InfoItem label={t('User ID')}>
                  <TableId value={userInfo.id} />
                </InfoItem>
                <InfoItem label={t('Email')}>{userInfo.email || '-'}</InfoItem>
                <InfoItem label={t('Created At')}>
                  {formatTimestampToDate(userInfo.created_at)}
                </InfoItem>
                <InfoItem label={t('Last Login')}>
                  {formatTimestampToDate(userInfo.last_login_at)}
                </InfoItem>
              </dl>
            </InfoCard>

            <InfoCard
              title={t('Wallet')}
              icon={<WalletCards className='text-muted-foreground size-4' />}
            >
              <dl className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2'>
                <InfoItem label={t('Balance')}>
                  {formatQuota(userInfo.quota)}
                </InfoItem>
                <InfoItem label={t('Used Quota')}>
                  {formatQuota(userInfo.used_quota)}
                </InfoItem>
                {userInfo.bonus_quota !== undefined && (
                  <InfoItem label={t('Bonus Balance')}>
                    {formatQuota(userInfo.bonus_quota)}
                  </InfoItem>
                )}
                {userInfo.paid_quota !== undefined && (
                  <InfoItem label={t('Paid Balance')}>
                    {formatQuota(userInfo.paid_quota)}
                  </InfoItem>
                )}
                <InfoItem label={t('Request Count')}>
                  {formatCompactNumber(userInfo.request_count)}
                </InfoItem>
                <InfoItem label={t('User Group')}>
                  {userInfo.group || '-'}
                </InfoItem>
                {userInfo.max_concurrency !== undefined && (
                  <InfoItem label={t('Concurrency')}>
                    {userInfo.max_concurrency === 0
                      ? t('Unlimited')
                      : formatNumber(userInfo.max_concurrency)}
                  </InfoItem>
                )}
              </dl>
            </InfoCard>
          </div>

          <div className='grid gap-4 lg:grid-cols-2'>
            <InfoCard
              title={t('Referral Program')}
              icon={<UserRoundPlus className='text-muted-foreground size-4' />}
            >
              <dl className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2'>
                <InfoItem label={t('Affiliate Code')}>
                  {userInfo.aff_code || '-'}
                </InfoItem>
                <InfoItem label={t('Invited Users')}>
                  {userInfo.aff_count === undefined
                    ? '-'
                    : formatCompactNumber(userInfo.aff_count)}
                </InfoItem>
                <InfoItem label={t('Inviter ID')}>
                  {inviterId > 0 ? <TableId value={inviterId} /> : '-'}
                </InfoItem>
                <InfoItem label={t('Invitation Quota')}>
                  {formatQuota(userInfo.aff_quota ?? 0)}
                </InfoItem>
                {userInfo.aff_history_quota !== undefined && (
                  <InfoItem label={t('Historical Affiliate Quota')}>
                    {formatQuota(userInfo.aff_history_quota)}
                  </InfoItem>
                )}
                {userInfo.aff_reversed_quota !== undefined && (
                  <InfoItem label={t('Reversed Affiliate Quota')}>
                    {formatQuota(userInfo.aff_reversed_quota)}
                  </InfoItem>
                )}
              </dl>
            </InfoCard>

            <InfoCard
              title={t('Account Bindings')}
              icon={<Link2 className='text-muted-foreground size-4' />}
            >
              {bindings.length > 0 ? (
                <dl className='grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2'>
                  {bindings.map((binding) => (
                    <InfoItem key={binding.label} label={binding.label}>
                      {binding.value}
                    </InfoItem>
                  ))}
                </dl>
              ) : (
                <p className='text-muted-foreground text-sm'>
                  {t('Not bound')}
                </p>
              )}
            </InfoCard>
          </div>

          {userInfo.remark && (
            <InfoCard
              title={t('Remark')}
              icon={<UserRound className='text-muted-foreground size-4' />}
            >
              <p className='text-sm leading-relaxed font-medium break-words'>
                {userInfo.remark}
              </p>
            </InfoCard>
          )}
        </div>
      )}
      {!isLoading && !userInfo && (
        <div className='text-muted-foreground py-8 text-center text-sm'>
          {t('No user information available')}
        </div>
      )}
    </Dialog>
  )
}
