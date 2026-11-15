import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAuthStore } from '@/stores/auth-store'

import { useLogLiveRefresh } from '../hooks/use-log-live-refresh'

interface LogLiveRefreshProps {
  isAdmin: boolean
  pageIndex: number
  endTime: number | undefined
  onRefresh: () => Promise<unknown>
  onShowLatest: () => void
}

export function LogLiveRefresh(props: LogLiveRefreshProps) {
  const { t } = useTranslation()
  const id = useId()
  const [enabled, setEnabled] = useState(true)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const sessionId = useAuthStore((state) => state.auth.session?.sid)
  const paused =
    props.pageIndex !== 0 ||
    (props.endTime != null && props.endTime < Date.now())
  const { pending, connected } = useLogLiveRefresh({
    enabled: enabled && sessionId != null,
    isAdmin: props.isAdmin,
    userId,
    sessionId,
    paused: props.pageIndex !== 0,
    endTime: props.endTime,
    onRefresh: props.onRefresh,
  })

  return (
    <div className='flex min-h-8 flex-wrap items-center gap-3 text-sm'>
      <div className='flex items-center gap-2'>
        <Switch id={id} checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor={id}>{t('Live refresh')}</Label>
      </div>
      <span role='status' className='text-muted-foreground text-xs'>
        {enabled && !connected && t('Reconnecting')}
        {enabled && connected && paused && t('Live refresh paused')}
      </span>
      {enabled && pending && (
        <Button size='sm' variant='outline' onClick={props.onShowLatest}>
          {t('New logs available')}
        </Button>
      )}
    </div>
  )
}
