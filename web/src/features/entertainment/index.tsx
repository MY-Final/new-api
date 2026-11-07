import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Egg, Gift, Sparkles } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Main } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import {
  formatCurrencyFromUSD,
  formatQuotaWithCurrency,
  getCurrencyDisplay,
} from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useSystemConfigStore } from '@/stores/system-config-store'

type Prize = {
  id: string
  name: string
  quota: number
  quantity: number
  probability: number
}

type Draw = {
  day: string
  egg: number
  prize_name: string
  quota: number
}

type DailyEggStatus = {
  enabled: boolean
  day: string
  min_spend_cny: number
  spend_cny: number
  egg_count: number
  prizes: Prize[]
  eligible: boolean
  draw: Draw | null
}

export function Entertainment() {
  const { t, i18n } = useTranslation()
  useSystemConfigStore((state) => state.config.currency)
  const { config } = getCurrencyDisplay()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const reducedMotion = useReducedMotion()
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ['daily-egg'],
    queryFn: async () => {
      const response = await api.get('/api/user/daily_egg')
      return requireServerSuccess(response.data).data as DailyEggStatus
    },
    refetchInterval: 60_000,
  })
  const draw = useMutation({
    mutationFn: async (egg: number) => {
      const response = await api.post('/api/user/daily_egg', { egg })
      return requireServerSuccess(response.data).data as Draw
    },
    onSuccess: (result) => {
      queryClient.setQueryData<DailyEggStatus>(['daily-egg'], (previous) =>
        previous ? { ...previous, day: result.day, draw: result } : previous
      )
      void queryClient.invalidateQueries({ queryKey: ['daily-egg'] })
      void queryClient.invalidateQueries({ queryKey: ['user'] })
      void queryClient.invalidateQueries({ queryKey: ['self'] })
    },
    onError: (error) => {
      handleServerError(error, t('Unable to open an egg'))
      void queryClient.invalidateQueries({ queryKey: ['daily-egg'] })
    },
  })
  const data = status.data
  const result = data?.draw

  return (
    <Main className='overflow-y-auto'>
      <div className='mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12'>
        <header className='mb-8'>
          <Badge variant='outline'>{t('Entertainment')}</Badge>
          <h1 className='mt-4 text-3xl font-black tracking-tight sm:text-4xl'>
            {t('Daily egg')}
          </h1>
          <p className='text-muted-foreground mt-3 leading-7'>
            {t('Open one egg each day for a chance to win quota.')}
          </p>
        </header>

        {status.isLoading && <Skeleton className='h-96 w-full rounded-3xl' />}
        {status.isError && (
          <ErrorState
            title={t("Unable to load today's egg")}
            onRetry={() => void status.refetch()}
          />
        )}
        {data && !data.enabled && (
          <EmptyState icon={Egg} title={t('Daily egg is not enabled')} />
        )}
        {data?.enabled && (
          <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.38fr)]'>
            <Card className='dark:to-card border-orange-500/20 bg-gradient-to-br from-orange-50 via-amber-50 to-white dark:from-orange-950/50 dark:via-amber-950/30'>
              <CardContent className='px-4 py-8 text-center sm:px-8 sm:py-10'>
                <p className='text-muted-foreground text-sm tabular-nums'>
                  {t('Today')} · {data.day}
                </p>
                <h2 className='mt-4 text-xl font-bold'>{t('Choose an egg')}</h2>
                <p className='text-muted-foreground mt-2 text-sm'>
                  {t('Daily spending')}:{' '}
                  {formatCurrencyFromUSD(
                    data.spend_cny / config.usdExchangeRate,
                    {
                      digitsLarge: 6,
                      digitsSmall: 8,
                      abbreviate: false,
                      locale,
                    }
                  )}
                  {' / '}
                  {formatCurrencyFromUSD(
                    data.min_spend_cny / config.usdExchangeRate,
                    {
                      digitsLarge: 6,
                      digitsSmall: 8,
                      abbreviate: false,
                      locale,
                    }
                  )}
                </p>
                {!data.eligible && !result && (
                  <p className='mt-2 text-sm text-amber-700 dark:text-amber-300'>
                    {t('Reach the daily minimum spend to open an egg.')}
                  </p>
                )}
                <div
                  role='group'
                  aria-label={t('Choose an egg')}
                  className='mx-auto mt-8 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3'
                >
                  {Array.from(
                    { length: data.egg_count },
                    (_, index) => index + 1
                  ).map((egg) => (
                    <Button
                      key={egg}
                      variant='outline'
                      aria-label={t('Egg {{number}}', { number: egg })}
                      disabled={
                        draw.isPending || !data.eligible || Boolean(result)
                      }
                      onClick={() => draw.mutate(egg)}
                      className='bg-background/80 h-28 min-w-0 flex-col gap-2 rounded-2xl border-orange-500/25 sm:h-36'
                    >
                      {result?.egg === egg ? (
                        <Sparkles
                          aria-hidden='true'
                          className='size-9 text-amber-500'
                        />
                      ) : (
                        <Egg
                          aria-hidden='true'
                          className='size-9 text-orange-500'
                        />
                      )}
                      <span className='tabular-nums'>
                        {formatNumber(egg, locale)}
                      </span>
                    </Button>
                  ))}
                </div>
                <div className='mt-8 min-h-20' aria-live='polite'>
                  {result && (
                    <motion.div
                      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: reducedMotion ? 0 : 0.3 }}
                    >
                      <p className='text-xl font-bold'>
                        {result.quota > 0
                          ? result.prize_name
                          : t('No prize this time')}
                      </p>
                      {result.quota > 0 && (
                        <p className='mt-2 font-semibold text-emerald-600 dark:text-emerald-400'>
                          +{formatQuotaWithCurrency(result.quota)}
                        </p>
                      )}
                      <p className='text-muted-foreground mt-2 text-sm'>
                        {t('Come back tomorrow')}
                      </p>
                    </motion.div>
                  )}
                  {draw.isPending && (
                    <p className='text-muted-foreground text-sm'>
                      {t('Opening...')}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className='space-y-4 p-6'>
                <h2 className='flex items-center gap-2 text-base font-semibold'>
                  <Gift className='size-4' /> {t('Prize pool')}
                </h2>
                <ul className='divide-y'>
                  {data.prizes.map((prize) => (
                    <li
                      key={prize.id}
                      className='flex items-start justify-between gap-3 py-3 text-sm'
                    >
                      <div className='min-w-0'>
                        <p className='font-medium break-words'>{prize.name}</p>
                        <p className='text-muted-foreground mt-1'>
                          {formatQuotaWithCurrency(prize.quota)}
                        </p>
                      </div>
                      <div className='shrink-0 text-right tabular-nums'>
                        <p>{formatNumber(prize.probability / 100, locale)}%</p>
                        <p className='text-muted-foreground mt-1'>
                          {t('Daily quantity')}:{' '}
                          {formatNumber(prize.quantity, locale)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className='text-muted-foreground text-xs leading-5'>
                  {t(
                    'Quantities reset daily. Remaining probability and exhausted prizes result in no prize.'
                  )}
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Main>
  )
}
