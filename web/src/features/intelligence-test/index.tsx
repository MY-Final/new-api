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
  Brain,
  CheckCircle2,
  Clock3,
  Loader2,
  Palette,
  Play,
  Settings2,
  Square,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { ConnectionDialog } from './components/connection-dialog'
import {
  DrawingResultCard,
  KnowledgeResultCard,
  LogicResultCard,
  ResultCardSkeleton,
} from './components/result-cards'
import { StyleDialog } from './components/style-dialog'
import { MAX_OUTPUT_TOKENS } from './constants'
import { useIntelligenceRun } from './hooks/use-intelligence-run'
import type { ConnectionConfig, TaskId, TaskStatus } from './types'

const ALL_TASKS: TaskId[] = ['logic', 'drawing', 'knowledge']
const SCORED_TASKS = new Set<TaskId>(['logic', 'knowledge'])

function isTerminalStatus(status: TaskStatus): boolean {
  return (
    status === 'passed' || status === 'failed' || status === 'technical_error'
  )
}

function getConnectionLabel(connection: ConnectionConfig | null): string {
  if (!connection) return ''
  if (connection.kind === 'platform') {
    return `${connection.keyName} · ${connection.model}`
  }
  return `${connection.name} · ${connection.model}`
}

export function IntelligenceTest() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [connection, setConnection] = useState<ConnectionConfig | null>(null)
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const [nextRunNumber, setNextRunNumber] = useState(1)
  const [selectedTasks, setSelectedTasks] = useState<TaskId[]>(ALL_TASKS)
  const [styleDialogOpen, setStyleDialogOpen] = useState(false)
  const [customStyleDescription, setCustomStyleDescription] = useState('')
  const { snapshot, isRunning, run, reset, cancelRun } = useIntelligenceRun()

  const taskEntries = [
    { id: 'logic' as const, result: snapshot.logic },
    { id: 'drawing' as const, result: snapshot.drawing },
    { id: 'knowledge' as const, result: snapshot.knowledge },
  ]
  const runTasks = snapshot.tasks
  const completedCount = taskEntries.filter(
    (entry) =>
      runTasks.includes(entry.id) && isTerminalStatus(entry.result.status)
  ).length
  const scoredTasks = runTasks.filter((task) => SCORED_TASKS.has(task))
  const passedCount = taskEntries.filter(
    (entry) =>
      scoredTasks.includes(entry.id) && entry.result.status === 'passed'
  ).length
  const requestEstimate = selectedTasks.length
  const tokenEstimate = selectedTasks.reduce(
    (total, task) => total + MAX_OUTPUT_TOKENS[task],
    0
  )
  const idleRunLabel = connection ? t('Run again') : t('Start test')

  const handleRun = () => {
    if (!connection) {
      setConnectionDialogOpen(true)
      return
    }
    if (selectedTasks.length === 0) return

    const trimmedStyle = customStyleDescription.trim()
    const customStyle = trimmedStyle
      ? {
          name:
            trimmedStyle.length > 24
              ? `${trimmedStyle.slice(0, 24)}…`
              : trimmedStyle,
          description: trimmedStyle,
        }
      : undefined
    const runNumber = nextRunNumber
    setNextRunNumber((value) => value + 1)
    void run(connection, runNumber, selectedTasks, customStyle)
  }

  const handleUseConnection = (nextConnection: ConnectionConfig) => {
    setConnection(nextConnection)
    reset()
  }

  return (
    <div className='mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-6 overflow-y-auto p-4 md:p-6'>
      <header className='space-y-5'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {t('Intelligence Test')}
          </h1>
          <p className='text-muted-foreground mt-1 text-sm'>
            {t(
              'Run three independent model challenges and inspect reasoning, drawing, and knowledge results.'
            )}
          </p>
        </div>

        <Card>
          <CardContent className='space-y-4 pt-0'>
            <div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
              <Button
                type='button'
                variant='outline'
                className='h-10 min-w-0 flex-1 justify-start overflow-hidden text-left'
                onClick={() => setConnectionDialogOpen(true)}
              >
                <Settings2 />
                <span className='truncate'>
                  {connection
                    ? getConnectionLabel(connection)
                    : t('Choose a test model')}
                </span>
              </Button>
              <Button
                type='button'
                className='h-10 min-w-36'
                disabled={isRunning || selectedTasks.length === 0}
                onClick={handleRun}
              >
                {isRunning ? <Loader2 className='animate-spin' /> : <Play />}
                {isRunning ? t('Running tests...') : idleRunLabel}
              </Button>
              {isRunning && (
                <Button
                  type='button'
                  variant='outline'
                  className='h-10 min-w-24'
                  onClick={cancelRun}
                >
                  <Square />
                  {t('Cancel')}
                </Button>
              )}
            </div>
            <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3'>
              <span className='text-sm font-medium'>{t('Tasks to run')}</span>
              <ToggleGroup
                multiple
                value={selectedTasks}
                onValueChange={(values) => {
                  const nextTasks = ALL_TASKS.filter((task) =>
                    values.includes(task)
                  )
                  const enablesDrawing =
                    nextTasks.includes('drawing') &&
                    !selectedTasks.includes('drawing')
                  setSelectedTasks(nextTasks)
                  if (enablesDrawing) setStyleDialogOpen(true)
                }}
                variant='outline'
                size='sm'
                className='flex-wrap'
                aria-label={t('Tasks to run')}
              >
                <ToggleGroupItem
                  value='logic'
                  className='data-[pressed]:border-primary data-[pressed]:text-primary data-[pressed]:ring-primary/40 data-[pressed]:font-semibold data-[pressed]:ring-1'
                >
                  <Brain aria-hidden='true' />
                  {t('Logical reasoning')}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value='drawing'
                  className='data-[pressed]:border-primary data-[pressed]:text-primary data-[pressed]:ring-primary/40 data-[pressed]:font-semibold data-[pressed]:ring-1'
                >
                  <Palette aria-hidden='true' />
                  {t('Drawing and animation')}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value='knowledge'
                  className='data-[pressed]:border-primary data-[pressed]:text-primary data-[pressed]:ring-primary/40 data-[pressed]:font-semibold data-[pressed]:ring-1'
                >
                  <Clock3 aria-hidden='true' />
                  {t('Knowledge freshness')}
                </ToggleGroupItem>
              </ToggleGroup>
              {selectedTasks.includes('drawing') && (
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => setStyleDialogOpen(true)}
                >
                  <Palette aria-hidden='true' />
                  {t('Style')}
                </Button>
              )}
            </div>
            <div className='text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs'>
              <span>
                {t('{{tasks}} tasks · 1 run · up to {{requests}} requests', {
                  tasks: selectedTasks.length,
                  requests: requestEstimate,
                })}
              </span>
              <span>
                {t(
                  'Billed at normal model prices. Up to {{tokens}} output tokens.',
                  { tokens: formatNumber(tokenEstimate, locale) }
                )}
              </span>
              <span>
                {t(
                  'The animation HTML may take 10-30 minutes to generate. Keep this page open.'
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      </header>

      <section className='space-y-4'>
        <div className='flex items-center justify-between gap-4'>
          <h2 className='text-lg font-semibold'>{t('Test results')}</h2>
          <div className='flex items-center gap-2'>
            {runTasks.length > 0 && (
              <Badge
                variant={
                  completedCount === runTasks.length ? 'default' : 'secondary'
                }
              >
                <CheckCircle2 />
                {t('{{completed}}/{{total}} completed', {
                  completed: completedCount,
                  total: runTasks.length,
                })}
              </Badge>
            )}
            {scoredTasks.length > 0 && (
              <Badge variant='outline'>
                {t('{{passed}} passed', { passed: passedCount })}
              </Badge>
            )}
          </div>
        </div>

        <div className='grid gap-4 xl:grid-cols-3'>
          {snapshot.runNumber === 0 ? (
            <>
              <ResultCardSkeleton
                icon={<Brain className='size-4 text-emerald-500' />}
                title={t('Logical reasoning')}
                subtitle={t('Candy combination and guarantee')}
              />
              <ResultCardSkeleton
                icon={<Palette className='size-4 text-rose-500' />}
                title={t('Drawing and animation')}
                subtitle={t('Pelican cycling SVG animation')}
              />
              <ResultCardSkeleton
                icon={<Clock3 className='size-4 text-amber-500' />}
                title={t('Knowledge freshness')}
                subtitle={t('Three-question knowledge check')}
              />
            </>
          ) : (
            <>
              <LogicResultCard result={snapshot.logic} />
              <DrawingResultCard
                result={snapshot.drawing}
                styleName={snapshot.styleName}
              />
              <KnowledgeResultCard result={snapshot.knowledge} />
            </>
          )}
        </div>
      </section>

      <ConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
        onUseConnection={handleUseConnection}
      />

      <StyleDialog
        open={styleDialogOpen}
        onOpenChange={setStyleDialogOpen}
        initialDescription={customStyleDescription}
        onUseStyle={setCustomStyleDescription}
      />
    </div>
  )
}
