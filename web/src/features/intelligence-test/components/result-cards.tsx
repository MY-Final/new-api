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
  AlertTriangle,
  Brain,
  Check,
  Clock3,
  Minus,
  Palette,
  Play,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CodeBlock } from '@/components/ai-elements/code-block'
import {
  WebPreview,
  WebPreviewBody,
} from '@/components/ai-elements/web-preview'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { LOGIC_EXPECTED } from '../constants'
import { buildSandboxedPreviewHtml } from '../lib/evaluation'
import type {
  DrawingEvaluation,
  KnowledgeResult,
  LogicResult,
  TaskResult,
  TaskStatus,
} from '../types'
import { AnimationPreviewDialog } from './animation-preview-dialog'

function formatDuration(durationMs: number, unit: string): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
  return `${(durationMs / 1000).toFixed(1)}${unit}`
}

function StatusBadge(props: {
  status: TaskStatus
  labels?: Partial<Record<TaskStatus, string>>
}) {
  const { t } = useTranslation()

  if (props.status === 'passed') {
    return (
      <Badge variant='default' className='gap-1'>
        <Check />
        {props.labels?.passed ?? t('Passed')}
      </Badge>
    )
  }
  if (props.status === 'failed') {
    return (
      <Badge variant='destructive' className='gap-1'>
        <X />
        {props.labels?.failed ?? t('Failed')}
      </Badge>
    )
  }
  if (props.status === 'technical_error') {
    return (
      <Badge variant='warning' className='gap-1'>
        <AlertTriangle />
        {t('Technical failure')}
      </Badge>
    )
  }
  if (props.status === 'skipped') {
    return (
      <Badge variant='outline' className='gap-1'>
        <Minus />
        {t('Not selected')}
      </Badge>
    )
  }
  return (
    <Badge variant='secondary' className='gap-1'>
      {props.status === 'running' && (
        <span className='size-1.5 animate-pulse rounded-full bg-current' />
      )}
      {props.status === 'running' ? t('Running') : t('Waiting')}
    </Badge>
  )
}

function RunningElapsed() {
  const { t } = useTranslation()
  const [startedAt] = useState(() => Date.now())
  const [elapsedMs, setElapsedMs] = useState(1000)
  const unit = t('s')

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  return (
    <span className='text-muted-foreground text-xs tabular-nums'>
      {formatDuration(elapsedMs, unit)}
    </span>
  )
}

function TaskCardHeader(props: {
  icon: React.ReactNode
  title: string
  subtitle: string
  status: TaskStatus
  durationMs: number
  statusLabels?: Partial<Record<TaskStatus, string>>
}) {
  const { t } = useTranslation()
  return (
    <CardHeader className='border-b'>
      <CardTitle className='flex items-center gap-2'>
        {props.icon}
        <span>{props.title}</span>
      </CardTitle>
      <CardDescription>{props.subtitle}</CardDescription>
      <CardAction className='flex flex-col items-end gap-2'>
        <StatusBadge status={props.status} labels={props.statusLabels} />
        {props.status === 'running' ? (
          <RunningElapsed />
        ) : (
          props.durationMs > 0 && (
            <span className='text-muted-foreground text-xs tabular-nums'>
              {formatDuration(props.durationMs, t('s'))}
            </span>
          )
        )}
      </CardAction>
    </CardHeader>
  )
}

function TaskError(props: { result: TaskResult<unknown> }) {
  const { t } = useTranslation()
  if (!props.result.error) return null

  return (
    <div className='bg-muted/40 text-muted-foreground rounded-lg p-3 text-sm'>
      {t(props.result.error)}
    </div>
  )
}

function TaskEmptyState(props: { result: TaskResult<unknown> }) {
  const { t } = useTranslation()

  if (props.result.status === 'skipped') {
    return (
      <div className='bg-muted/40 text-muted-foreground rounded-lg p-3 text-sm'>
        {t('This task was not selected for this run.')}
      </div>
    )
  }

  return <TaskError result={props.result} />
}

function RawResponse(props: { rawResponse: string; language?: string }) {
  const { t } = useTranslation()
  if (!props.rawResponse) return null

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button type='button' variant='ghost' size='sm' className='px-0' />
        }
      >
        {t('View raw response')}
      </CollapsibleTrigger>
      <CollapsibleContent className='pt-3'>
        <CodeBlock
          code={props.rawResponse}
          language={props.language ?? 'text'}
          title={t('Raw response')}
          defaultCollapsed
          collapsedLines={10}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

function SourceCode(props: { html: string }) {
  const { t } = useTranslation()

  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button type='button' variant='ghost' size='sm' className='px-0' />
        }
      >
        {t('View source code')}
      </CollapsibleTrigger>
      <CollapsibleContent className='pt-3'>
        <CodeBlock
          code={props.html}
          language='html'
          title={t('Source code')}
          defaultCollapsed
          collapsedLines={10}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

export function LogicResultCard(props: { result: TaskResult<LogicResult> }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const data = props.result.data

  return (
    <Card className='min-h-[390px]'>
      <TaskCardHeader
        icon={<Brain className='size-4 text-emerald-500' />}
        title={t('Logical reasoning')}
        subtitle={t('Candy combination and guarantee')}
        status={props.result.status}
        durationMs={props.result.durationMs}
      />
      <CardContent className='flex flex-1 flex-col gap-5'>
        {data ? (
          <>
            <div>
              <div className='text-3xl font-semibold tracking-tight'>
                {formatNumber(data.answer, locale)}
              </div>
              <p className='text-muted-foreground text-sm'>
                {t('Model answer')}
              </p>
            </div>
            <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm'>
              <dt className='text-muted-foreground'>{t('Expected answer')}</dt>
              <dd className='font-medium'>
                {formatNumber(LOGIC_EXPECTED.answer, locale)}
              </dd>
              <dt className='text-muted-foreground'>{t('Selection')}</dt>
              <dd className='font-medium'>
                {t('Round {{round}} / Star {{star}}', {
                  round: formatNumber(data.round, locale),
                  star: formatNumber(data.star, locale),
                })}
              </dd>
            </dl>
            <p className='text-muted-foreground text-sm leading-6'>
              {data.explanation}
            </p>
          </>
        ) : (
          <TaskEmptyState result={props.result} />
        )}
        <RawResponse rawResponse={props.result.rawResponse} language='json' />
      </CardContent>
    </Card>
  )
}

export function DrawingResultCard(props: {
  result: TaskResult<DrawingEvaluation>
  styleName: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [playbackKey, setPlaybackKey] = useState(0)
  const [animationPreviewOpen, setAnimationPreviewOpen] = useState(false)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(
    null
  )
  const data = props.result.data
  const previewHtml = data ? buildSandboxedPreviewHtml(data.html) : ''

  return (
    <Card className='min-h-[520px]'>
      <TaskCardHeader
        icon={<Palette className='size-4 text-rose-500' />}
        title={t('Drawing and animation')}
        subtitle={t('Pelican cycling SVG animation')}
        status={props.result.status}
        durationMs={props.result.durationMs}
        statusLabels={{
          passed: t('Generated'),
          failed: t('Generation failed'),
        }}
      />
      <CardContent className='flex flex-1 flex-col gap-4'>
        <div className='flex items-center justify-between gap-3'>
          <Badge variant='outline'>
            {props.styleName || t('Pending style')}
          </Badge>
          {data && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setPlaybackKey((value) => value + 1)}
            >
              <Play />
              {t('Replay')}
            </Button>
          )}
        </div>

        {props.result.status === 'running' &&
          typeof props.result.progress === 'number' &&
          props.result.progress > 0 && (
            <div className='text-muted-foreground text-xs'>
              {t('Received {{count}} characters', {
                count: formatNumber(props.result.progress, locale),
              })}
            </div>
          )}

        {data && (
          <>
            <div className='bg-muted/20 relative aspect-[3/2] w-full overflow-hidden rounded-lg border'>
              <WebPreview className='rounded-none border-0'>
                <WebPreviewBody
                  key={playbackKey}
                  srcDoc={previewHtml}
                  sandbox=''
                  title={t('Drawing animation preview')}
                  className='h-full w-full'
                />
              </WebPreview>
              <Button
                type='button'
                variant='ghost'
                className='absolute inset-0 z-10 h-full w-full cursor-zoom-in rounded-lg p-0 hover:bg-transparent'
                aria-label={t('Preview animation')}
                onClick={() => setAnimationPreviewOpen(true)}
              />
            </div>
            <div className='grid gap-3 sm:grid-cols-[1fr_150px]'>
              <div className='space-y-2'>
                <p className='text-sm font-medium'>{t('Structure checks')}</p>
                <div className='flex flex-wrap gap-2'>
                  <Badge
                    variant={
                      data.validation.infiniteLoop ? 'default' : 'warning'
                    }
                  >
                    {data.validation.infiniteLoop
                      ? t('Loop detected')
                      : t('No loop detected')}
                  </Badge>
                </div>
              </div>
              {data.screenshot && (
                <Button
                  type='button'
                  variant='ghost'
                  className='h-auto w-full cursor-zoom-in p-0'
                  aria-label={t('Preview screenshot')}
                  onClick={() => setScreenshotPreview(data.screenshot)}
                >
                  <img
                    src={data.screenshot}
                    alt={t('Rendered drawing screenshot')}
                    className='bg-muted aspect-[3/2] w-full rounded-md border object-contain'
                  />
                </Button>
              )}
            </div>
            <SourceCode html={data.html} />
          </>
        )}
        <TaskEmptyState result={props.result} />
        <RawResponse rawResponse={props.result.rawResponse} language='html' />
        <AnimationPreviewDialog
          open={animationPreviewOpen}
          onOpenChange={setAnimationPreviewOpen}
          html={previewHtml}
        />
        <ImagePreviewDialog
          src={screenshotPreview}
          alt={t('Rendered drawing screenshot')}
          onClose={() => setScreenshotPreview(null)}
        />
      </CardContent>
    </Card>
  )
}

export function KnowledgeResultCard(props: {
  result: TaskResult<KnowledgeResult>
}) {
  const { t } = useTranslation()
  const data = props.result.data

  return (
    <Card className='min-h-[390px]'>
      <TaskCardHeader
        icon={<Clock3 className='size-4 text-amber-500' />}
        title={t('Knowledge freshness')}
        subtitle={t('Three-question knowledge check')}
        status={props.result.status}
        durationMs={props.result.durationMs}
      />
      <CardContent className='flex flex-1 flex-col gap-4'>
        {data ? (
          <div className='space-y-3'>
            {data.answers.map((answer) => (
              <div key={answer.id} className='rounded-lg border p-3 text-sm'>
                <div className='mb-2 flex items-center justify-between gap-3'>
                  <span className='font-medium uppercase'>{answer.id}</span>
                  <Badge variant={answer.passed ? 'default' : 'destructive'}>
                    {answer.passed ? t('Passed') : t('Failed')}
                  </Badge>
                </div>
                <p className='break-words'>
                  {answer.answer?.join(', ') || t('No answer')}
                </p>
                {!answer.passed && (
                  <p className='text-muted-foreground mt-2 text-xs'>
                    {t('Expected')}: {answer.expected.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <TaskEmptyState result={props.result} />
        )}
        <RawResponse rawResponse={props.result.rawResponse} language='json' />
      </CardContent>
    </Card>
  )
}

export function ResultCardSkeleton(props: {
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  const { t } = useTranslation()
  return (
    <Card className='min-h-[390px]'>
      <TaskCardHeader
        icon={props.icon}
        title={props.title}
        subtitle={props.subtitle}
        status='queued'
        durationMs={0}
      />
      <CardContent className='flex flex-1 items-center justify-center'>
        <div className='text-muted-foreground text-sm'>
          {t('Waiting to start')}
        </div>
      </CardContent>
    </Card>
  )
}
