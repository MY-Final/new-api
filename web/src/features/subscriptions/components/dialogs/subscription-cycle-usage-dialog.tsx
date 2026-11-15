import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'

import { SubscriptionCycleUsage } from '../subscription-cycle-usage'

interface SubscriptionCycleUsageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: number; username?: string } | null
}

export function SubscriptionCycleUsageDialog(
  props: SubscriptionCycleUsageDialogProps
) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Subscription cycle usage')}
      description={`${props.user?.username ?? ''} · ID: ${props.user?.id ?? '-'}`}
      contentClassName='sm:max-w-5xl'
    >
      {props.open && props.user && (
        <SubscriptionCycleUsage userId={props.user.id} />
      )}
    </Dialog>
  )
}
