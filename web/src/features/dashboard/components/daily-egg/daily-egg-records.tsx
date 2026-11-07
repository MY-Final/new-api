import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableServerPagination,
  StaticDataTable,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebounce } from '@/hooks/use-debounce'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useSystemConfigStore } from '@/stores/system-config-store'

type Draw = {
  id: number
  user_id: number
  username: string
  egg: number
  prize_name: string
  quota: number
  created_at: number
}

type Prize = {
  id: string
  name: string
  quantity: number
  issued: number
  remaining: number
}

type Records = {
  day: string
  today: string
  items: Draw[]
  total: number
  prizes: Prize[] | null
}

export function DailyEggRecords(props: { refetchInterval?: number | false }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
  const [day, setDay] = useState('')
  const [username, setUsername] = useState('')
  const [prize, setPrize] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const searchUsername = useDebounce(username.trim(), 300)
  const searchPrize = useDebounce(prize.trim(), 300)
  const query = useQuery({
    queryKey: [
      'daily-egg',
      'records',
      day,
      searchUsername,
      searchPrize,
      page,
      pageSize,
    ],
    queryFn: async () => {
      const response = await api.get('/api/daily_egg/records', {
        params: {
          day: day || undefined,
          username: searchUsername || undefined,
          prize: searchPrize || undefined,
          p: page,
          page_size: pageSize,
        },
      })
      return requireServerSuccess(response.data).data as Records
    },
    refetchInterval: props.refetchInterval,
  })
  const data = query.data
  const number = (value: number) => formatNumber(value, locale)
  const columns = [
    {
      id: 'user_id',
      header: t('User ID'),
      cell: (row: Draw) => number(row.user_id),
    },
    {
      id: 'username',
      header: t('Username'),
      cell: (row: Draw) => row.username || `#${row.user_id}`,
    },
    {
      id: 'egg',
      header: t('Egg number'),
      cell: (row: Draw) => number(row.egg),
    },
    {
      id: 'prize_name',
      header: t('Prize'),
      cell: (row: Draw) => row.prize_name || t('No prize'),
    },
    {
      id: 'quota',
      header: t('Reward'),
      cell: (row: Draw) => formatQuotaWithCurrency(row.quota, { locale }),
    },
    {
      id: 'created_at',
      header: t('Time'),
      cell: (row: Draw) =>
        new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'medium',
          timeZone: 'Asia/Shanghai',
        }).format(row.created_at * 1000),
    },
  ]
  const prizeColumns = [
    { id: 'name', header: t('Prize'), cell: (row: Prize) => row.name },
    {
      id: 'quantity',
      header: t('Quantity'),
      cell: (row: Prize) => number(row.quantity),
    },
    {
      id: 'issued',
      header: t('Issued'),
      cell: (row: Prize) => number(row.issued),
    },
    {
      id: 'remaining',
      header: t('Remaining'),
      cell: (row: Prize) => number(row.remaining),
    },
  ]

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Input
          type='date'
          aria-label={t('Date')}
          value={day || data?.day || ''}
          max={data?.today}
          className='w-auto'
          onChange={(event) => {
            if (event.target.value) {
              setDay(event.target.value)
              setPage(1)
            }
          }}
        />
        <Input
          aria-label={t('Username')}
          placeholder={t('Search username')}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value)
            setPage(1)
          }}
          className='w-full sm:w-48'
        />
        <Input
          aria-label={t('Prize')}
          placeholder={t('Search prize')}
          value={prize}
          onChange={(event) => {
            setPrize(event.target.value)
            setPage(1)
          }}
          className='w-full sm:w-48'
        />
      </div>
      {query.isPending && <Skeleton className='h-48 w-full' />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {data && (
        <>
          {data.day === data.today && (
            <section className='space-y-2'>
              <h2 className='font-medium'>{t("Today's prize inventory")}</h2>
              <p className='text-muted-foreground text-sm'>
                {t('Inventory uses the current prize settings.')}
              </p>
              <StaticDataTable
                columns={prizeColumns}
                data={data.prizes || []}
                getRowKey={(row) => row.id}
                emptyContent={t(
                  'No records found. Try adjusting your filters.'
                )}
              />
            </section>
          )}
          <StaticDataTable
            columns={columns}
            data={data.items}
            getRowKey={(row) => row.id}
            emptyContent={t('No records found. Try adjusting your filters.')}
          />
          <DataTableServerPagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}
    </div>
  )
}
