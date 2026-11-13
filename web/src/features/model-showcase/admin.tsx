import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { deleteShowcasePlan, getShowcase, runShowcasePlan } from './api'
import { ShowcasePlanForm } from './components/showcase-plan-form'
import type { ShowcasePlan } from './types'

export function ShowcaseAdmin() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const [editing, setEditing] = useState<ShowcasePlan | null | undefined>()
  const [deleting, setDeleting] = useState<ShowcasePlan | null>(null)
  const plans = useQuery({
    queryKey: ['model-showcase', 'admin'],
    queryFn: () => getShowcase(true),
    refetchInterval: 15_000,
  })
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ['model-showcase'] })
  const remove = useMutation({
    mutationFn: deleteShowcasePlan,
    onSuccess: () => {
      setDeleting(null)
      refresh()
    },
  })
  const run = useMutation({
    mutationFn: runShowcasePlan,
    onSuccess: () => {
      toast.success(t('Showcase test queued'))
      refresh()
    },
  })
  const statusLabels = {
    succeeded: t('Completed'),
    running: t('Running tests...'),
    failed: t('Failed'),
  }

  return (
    <SettingsSection title={t('Model showcase')}>
      <div className='flex flex-wrap justify-between gap-3'>
        <p className='text-muted-foreground max-w-2xl text-sm'>
          {t(
            'Manage platform-funded test plans. Visitors only view the shared results and never pay for these requests.'
          )}
        </p>
        <div className='flex gap-2'>
          <Button variant='outline' render={<Link to='/showcase' />}>
            {t('View showcase')}
          </Button>
          <Button
            disabled={(plans.data?.length ?? 0) >= 50}
            onClick={() => setEditing(null)}
          >
            <Plus />
            {t('Add test plan')}
          </Button>
        </div>
      </div>
      {plans.isPending && <LoadingState />}
      {plans.isError && <ErrorState onRetry={() => void plans.refetch()} />}
      {plans.data?.length === 0 && (
        <EmptyState title={t('No test plans yet')} />
      )}
      <div className='space-y-3'>
        {plans.data?.map((plan) => (
          <Card key={plan.id}>
            <CardContent className='flex flex-wrap items-center justify-between gap-4'>
              <div className='min-w-0 space-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium break-words'>{plan.name}</span>
                  <Badge variant={plan.enabled ? 'secondary' : 'outline'}>
                    {plan.enabled ? t('Scheduled') : t('Paused')}
                  </Badge>
                  <Badge variant='outline'>
                    {plan.public ? t('Public') : t('Private')}
                  </Badge>
                </div>
                <p className='text-muted-foreground text-xs break-words'>
                  {plan.group} · {plan.model} ·{' '}
                  {t('Every {{minutes}} minutes', {
                    minutes: formatNumber(plan.interval_minutes, locale),
                  })}{' '}
                  ·{' '}
                  {t('Keep {{count}} results', {
                    count: formatNumber(plan.keep_count, locale),
                  })}
                </p>
                {plan.runs[0] && (
                  <p className='text-muted-foreground text-xs'>
                    {t('Latest test')}: {statusLabels[plan.runs[0].status]}
                  </p>
                )}
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={
                    run.isPending ||
                    plan.run_requested ||
                    plan.runs[0]?.status === 'running'
                  }
                  onClick={() => run.mutate(plan.id)}
                >
                  <Play />
                  {plan.run_requested ? t('Queued') : t('Run now')}
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setEditing(plan)}
                  aria-label={t('Edit {{name}}', { name: plan.name })}
                >
                  <Pencil />
                  {t('Edit')}
                </Button>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setDeleting(plan)}
                  aria-label={t('Delete {{name}}', { name: plan.name })}
                >
                  <Trash2 />
                  {t('Delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined)
        }}
        title={editing ? t('Edit test plan') : t('Add test plan')}
      >
        {editing !== undefined && (
          <ShowcasePlanForm
            key={editing?.id ?? 'new'}
            plan={editing}
            onCancel={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined)
              refresh()
            }}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete test plan')}
        desc={t('This deletes the test plan and all of its saved results.')}
        destructive
        isLoading={remove.isPending}
        confirmText={t('Delete')}
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
    </SettingsSection>
  )
}
