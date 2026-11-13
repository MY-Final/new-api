import { useQuery } from '@tanstack/react-query'
import { Maximize2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AnimationPreviewDialog } from '@/features/intelligence-test/components/animation-preview-dialog'
import {
  buildSandboxedPreviewHtml,
  extractCompleteHtml,
  validateDrawingHtml,
} from '@/features/intelligence-test/lib/evaluation'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getShowcaseRun } from '../api'
import type { ShowcaseRun } from '../types'

export function ShowcaseRunCard(props: { run: ShowcaseRun }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [animationOpen, setAnimationOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const terminal = props.run.status !== 'running'

  useEffect(() => {
    const element = container.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '100px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const result = useQuery({
    queryKey: ['showcase-run', props.run.id, props.run.status],
    queryFn: () => getShowcaseRun(props.run.id),
    enabled: terminal && (visible || detailsOpen || animationOpen),
    staleTime: Infinity,
    meta: { errorToast: false },
  })
  const preview = useMemo(() => {
    const html = extractCompleteHtml(result.data?.output ?? '')
    if (!html) return ''
    return validateDrawingHtml(html).valid
      ? buildSandboxedPreviewHtml(html)
      : ''
  }, [result.data?.output])
  const statusLabel = {
    running: t('Running tests...'),
    succeeded: t('Completed'),
    failed: t('Failed'),
  }[props.run.status]
  const loadingMessage = terminal ? t('Loading...') : statusLabel
  const timestamp = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(props.run.started_at * 1000))

  return (
    <Card ref={container} className='w-[266px] gap-0 overflow-hidden py-0'>
      <div className='flex items-center justify-between border-b px-3 py-2'>
        <Badge
          variant={props.run.status === 'failed' ? 'destructive' : 'secondary'}
        >
          {statusLabel}
        </Badge>
        <time
          className='text-muted-foreground text-xs'
          dateTime={new Date(props.run.started_at * 1000).toISOString()}
        >
          {timestamp}
        </time>
      </div>
      <div className='bg-muted/30 relative h-[176px] w-[264px] overflow-hidden'>
        {visible && preview ? (
          <>
            <WebPreview className='h-[800px] w-[1200px] origin-top-left scale-[0.22] rounded-none border-0'>
              <WebPreviewBody
                srcDoc={preview}
                sandbox=''
                title={t('Drawing animation preview')}
              />
            </WebPreview>
            <Button
              variant='ghost'
              className='absolute inset-0 h-full w-full cursor-zoom-in rounded-none hover:bg-transparent'
              aria-label={t('Preview animation')}
              onClick={() => setAnimationOpen(true)}
            >
              <Maximize2 className='bg-background/80 absolute right-2 bottom-2 size-6 rounded p-1' />
            </Button>
          </>
        ) : (
          <div className='text-muted-foreground flex h-full items-center justify-center p-4 text-center text-xs'>
            {result.isFetching || !terminal ? (
              <LoadingState inline message={loadingMessage} size='sm' />
            ) : (
              <span>
                {props.run.error
                  ? t(props.run.error)
                  : t('Open details to inspect the model output.')}
              </span>
            )}
          </div>
        )}
      </div>
      <div className='space-y-2 border-t p-3 text-xs'>
        <p className='truncate font-medium' title={props.run.model}>
          {props.run.model}
        </p>
        <div className='text-muted-foreground flex justify-between gap-2'>
          <span>
            {t('{{seconds}} s', {
              seconds: formatNumber(props.run.duration_ms / 1000, locale),
            })}
          </span>
          <span>
            {t('Tokens')}: {formatNumber(props.run.prompt_tokens, locale)} /{' '}
            {formatNumber(props.run.completion_tokens, locale)}
          </span>
        </div>
        <Button
          variant='outline'
          size='sm'
          className='w-full'
          disabled={!terminal}
          onClick={() => setDetailsOpen(true)}
        >
          {t('View details')}
        </Button>
      </div>
      <AnimationPreviewDialog
        open={animationOpen}
        onOpenChange={setAnimationOpen}
        html={preview}
      />
      <Dialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title={props.run.name}
        description={`${props.run.group} · ${props.run.model} · ${timestamp}`}
      >
        {result.isError && (
          <Button variant='outline' onClick={() => void result.refetch()}>
            {t('Retry')}
          </Button>
        )}
        {result.isPending && <LoadingState />}
        {result.isSuccess && (
          <div className='space-y-4'>
            {props.run.error && (
              <p className='text-destructive text-sm'>{t(props.run.error)}</p>
            )}
            <div>
              <h3 className='mb-2 text-sm font-medium'>{t('Prompt')}</h3>
              <p className='bg-muted max-h-52 overflow-auto rounded-lg p-3 text-sm whitespace-pre-wrap'>
                {result.data.prompt}
              </p>
            </div>
            <div>
              <div className='mb-2 flex items-center justify-between'>
                <h3 className='text-sm font-medium'>{t('Raw response')}</h3>
                <CopyButton
                  value={result.data.output ?? ''}
                  aria-label={t('Copy output')}
                />
              </div>
              <pre className='bg-muted max-h-72 overflow-auto rounded-lg p-3 text-xs break-words whitespace-pre-wrap'>
                {result.data.output || t('No Data')}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  )
}
