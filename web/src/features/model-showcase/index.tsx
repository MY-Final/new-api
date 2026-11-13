import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { AuthenticatedLayout, Main, PublicLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getShowcase } from './api'
import { ShowcaseRunCard } from './components/showcase-run-card'

export function ModelShowcase() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  const showcase = useQuery({
    queryKey: ['model-showcase'],
    queryFn: () => getShowcase(),
    refetchInterval: 30_000,
    meta: { errorToast: false },
  })

  const content = (
    <div className='mx-auto max-w-7xl space-y-6 py-6'>
      <header className='bg-muted/30 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-6'>
        <div className='flex items-center gap-4'>
          <div className='bg-primary/10 rounded-xl p-3'>
            <Activity className='text-primary size-6' />
          </div>
          <div>
            <h1 className='text-2xl font-semibold'>{t('Model showcase')}</h1>
            <p className='text-muted-foreground mt-2 max-w-2xl text-sm'>
              {t(
                'Scheduled tests paid for by the platform. Compare real model outputs over time.'
              )}
            </p>
          </div>
        </div>
        <div className='flex gap-2'>
          {user?.role === ROLE.SUPER_ADMIN && (
            <Button
              variant='outline'
              render={
                <Link
                  to='/system-settings/operations/$section'
                  params={{ section: 'showcase' }}
                />
              }
            >
              {t('Manage test plans')}
            </Button>
          )}
          <Button
            variant='outline'
            disabled={showcase.isFetching}
            onClick={() => void showcase.refetch()}
          >
            <RefreshCw
              className={showcase.isFetching ? 'animate-spin' : undefined}
            />
            {t('Refresh')}
          </Button>
        </div>
      </header>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Viewing this page never starts a model request or charges your account. Failures remain in the history.'
        )}
      </p>
      {showcase.isPending && <LoadingState />}
      {showcase.isError && (
        <ErrorState onRetry={() => void showcase.refetch()} />
      )}
      {showcase.data?.length === 0 && (
        <EmptyState
          title={t('No public test plans yet')}
          description={t(
            'Results will appear here after the platform configures and runs a test plan.'
          )}
        />
      )}
      {showcase.data?.map((entry) => (
        <Card key={entry.id} className='min-w-0 overflow-hidden'>
          <CardHeader>
            <div className='flex flex-wrap items-center gap-2'>
              <CardTitle role='heading' aria-level={2} className='break-words'>
                {entry.name}
              </CardTitle>
              <Badge variant='outline'>{entry.group}</Badge>
              <Badge variant={entry.enabled ? 'secondary' : 'outline'}>
                {entry.enabled ? t('Scheduled') : t('Paused')}
              </Badge>
            </div>
            <p className='text-muted-foreground text-xs break-words'>
              {entry.model} ·{' '}
              {t('Every {{minutes}} minutes', {
                minutes: formatNumber(entry.interval_minutes, locale),
              })}
            </p>
            {entry.enabled && entry.next_run_at > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t('Next test: {{time}}', {
                  time: new Intl.DateTimeFormat(locale, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }).format(new Date(entry.next_run_at * 1000)),
                })}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {entry.runs.length === 0 ? (
              <EmptyState
                className='min-h-32'
                title={t('Waiting for the first test')}
              />
            ) : (
              <Carousel
                opts={{ align: 'start', dragFree: true }}
                aria-label={entry.name}
                className='pt-10'
              >
                <div className='absolute top-0 right-0 flex gap-2'>
                  <CarouselPrevious
                    className='static translate-y-0'
                    aria-label={t('Newer results')}
                  />
                  <CarouselNext
                    className='static translate-y-0'
                    aria-label={t('Older results')}
                  />
                </div>
                <CarouselContent>
                  {entry.runs.map((run) => (
                    <CarouselItem key={run.id} className='basis-[282px]'>
                      <ShowcaseRunCard run={run} />
                    </CarouselItem>
                  ))}
                </CarouselContent>
              </Carousel>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )

  if (user) {
    return (
      <AuthenticatedLayout>
        <Main className='block overflow-y-auto px-4 md:px-6'>{content}</Main>
      </AuthenticatedLayout>
    )
  }

  return <PublicLayout>{content}</PublicLayout>
}
