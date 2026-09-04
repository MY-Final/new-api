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
import { useNavigate } from '@tanstack/react-router'
import {
  Download,
  ExternalLink,
  History,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { STORAGE_KEYS, getCanvasStorageKey } from '@/features/canvas/constants'
import {
  clearHistory,
  discardLegacyHistory,
  downloadImage,
  getLegacyHistory,
  loadHistory,
  markLegacyMigrationPromptShown,
  migrateLegacyHistory,
  removeHistoryEntry,
  restoreHistoryEntry,
  shouldShowLegacyMigrationPrompt,
  subscribeHistoryChanges,
  type CanvasHistoryEntry,
} from '@/features/canvas/lib/history'
import { useAuthStore } from '@/stores/auth-store'

type LoadState = 'loading' | 'ready' | 'error'

export function CanvasHistory() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [entries, setEntries] = useState<CanvasHistoryEntry[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [preview, setPreview] = useState<{
    src: string
    alt: string
  } | null>(null)
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set())
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearLoading, setClearLoading] = useState(false)
  const [migrationCount, setMigrationCount] = useState<number | null>(null)
  const [migrationLoading, setMigrationLoading] = useState(false)
  const busyActionRef = useRef<string | null>(null)
  const loadRequestRef = useRef(0)
  const [loadedUserId, setLoadedUserId] = useState<number | null | undefined>()

  const setBusyActionValue = (value: string | null) => {
    busyActionRef.current = value
    setBusyAction(value)
  }

  const refreshHistory = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoadedUserId(undefined)
    if (!userId) {
      setEntries([])
      setLoadedUserId(null)
      setLoadState('ready')
      return
    }
    setLoadState('loading')
    try {
      const nextEntries = await loadHistory(userId)
      if (requestId !== loadRequestRef.current) return
      setEntries(nextEntries)
      setLoadedUserId(userId)
      setBrokenIds(new Set())
      setLoadState('ready')
      if (shouldShowLegacyMigrationPrompt()) {
        setMigrationCount(getLegacyHistory().length)
        markLegacyMigrationPromptShown()
      }
    } catch {
      if (requestId !== loadRequestRef.current) return
      setLoadedUserId(userId)
      setLoadState('error')
    }
  }, [userId])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    if (!userId) return
    return subscribeHistoryChanges(userId, () => {
      void refreshHistory()
    })
  }, [refreshHistory, userId])

  const handleDownload = async (entry: CanvasHistoryEntry) => {
    const action = `download:${entry.id}`
    if (busyActionRef.current) return
    setBusyActionValue(action)
    try {
      const success = await downloadImage(entry.image, `canvas-${entry.id}.png`)
      if (!success) {
        toast.error(t('Download failed. Try opening the original image.'))
      }
    } finally {
      setBusyActionValue(null)
    }
  }

  const handleDelete = async (entry: CanvasHistoryEntry) => {
    if (!userId || busyActionRef.current) return
    setBusyActionValue(`delete:${entry.id}`)
    try {
      await removeHistoryEntry(userId, entry.id)
      setEntries((current) => current.filter((item) => item.id !== entry.id))
      setBrokenIds((current) => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
      toast.success(t('Drawing record deleted.'), {
        action: {
          label: t('Undo'),
          onClick: () => void handleUndo(entry),
        },
      })
    } catch {
      toast.error(t('Unable to delete this drawing record.'))
      void refreshHistory()
    } finally {
      setBusyActionValue(null)
    }
  }

  const handleUndo = async (entry: CanvasHistoryEntry) => {
    if (!userId || busyActionRef.current) return
    setBusyActionValue(`undo:${entry.id}`)
    try {
      const result = await restoreHistoryEntry(userId, entry)
      if (!result.success) throw new Error(result.reason)
      await refreshHistory()
      toast.success(t('Drawing record restored.'))
    } catch {
      toast.error(t('Unable to restore this drawing record.'))
    } finally {
      setBusyActionValue(null)
    }
  }

  const handleClear = async () => {
    if (!userId || busyActionRef.current) return
    setClearLoading(true)
    setBusyActionValue('clear')
    try {
      await clearHistory(userId)
      setEntries([])
      setBrokenIds(new Set())
      setClearOpen(false)
      toast.success(t('Drawing records cleared.'))
    } catch {
      toast.error(t('Unable to clear drawing records.'))
    } finally {
      setClearLoading(false)
      setBusyActionValue(null)
    }
  }

  const handleImportLegacy = async () => {
    if (!userId || migrationLoading) return
    setMigrationLoading(true)
    try {
      const result = await migrateLegacyHistory(userId)
      if (!result.success) throw new Error(result.reason)
      setMigrationCount(null)
      await refreshHistory()
      toast.success(t('Previous drawing records imported.'))
    } catch {
      toast.error(t('Unable to import previous drawing records.'))
    } finally {
      setMigrationLoading(false)
    }
  }

  const handleDiscardLegacy = () => {
    discardLegacyHistory()
    setMigrationCount(null)
    toast.success(t('Previous drawing records discarded.'))
  }

  const handleImageError = (id: string) => {
    setBrokenIds((current) => new Set(current).add(id))
  }

  const isBusy = (kind: string, id: string) =>
    busyAction === `${kind}:${id}` || busyAction === 'clear'

  const historyReadyForUser =
    userId === undefined ? loadedUserId === null : loadedUserId === userId

  if (!historyReadyForUser || loadState === 'loading') {
    return (
      <div className='text-muted-foreground flex min-h-64 items-center justify-center gap-2 text-sm'>
        <Loader2 className='h-4 w-4 animate-spin' />
        {t('Loading drawing records...')}
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <Alert variant='destructive'>
        <History className='h-4 w-4' />
        <AlertTitle>
          {t('Unable to load drawing records. Please try again.')}
        </AlertTitle>
        <AlertDescription className='mt-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void refreshHistory()}
          >
            <RotateCcw className='h-4 w-4' />
            {t('Retry')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className='mx-auto max-w-6xl'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-lg font-bold'>{t('Drawing Records')}</h1>
          <p className='text-muted-foreground text-sm'>
            {t('Images and prompts generated in Canvas are saved here.')}
          </p>
        </div>
        {entries.length > 0 && (
          <Button
            variant='outline'
            onClick={() => setClearOpen(true)}
            disabled={busyAction !== null}
          >
            <Trash2 className='h-4 w-4' />
            {t('Clear')}
          </Button>
        )}
      </div>

      {migrationCount !== null && (
        <Alert className='mt-6'>
          <History className='h-4 w-4' />
          <AlertTitle>{t('Previous drawing records found')}</AlertTitle>
          <AlertDescription className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <span>
              {t(
                '{{count}} previous drawing record(s) are available for import.',
                {
                  count: migrationCount,
                }
              )}
            </span>
            <span className='flex shrink-0 gap-2'>
              <Button
                size='sm'
                onClick={() => void handleImportLegacy()}
                disabled={migrationLoading}
              >
                {migrationLoading && (
                  <Loader2 className='h-4 w-4 animate-spin' />
                )}
                {t('Import')}
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={handleDiscardLegacy}
                disabled={migrationLoading}
              >
                {t('Discard')}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {entries.length === 0 ? (
        <div className='border-border text-muted-foreground mt-6 flex h-64 flex-col items-center justify-center gap-2 rounded-xl border text-sm'>
          <History className='h-8 w-8' />
          <span>{t('No drawing records yet.')}</span>
        </div>
      ) : (
        <div className='mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {entries.map((entry) => {
            const broken = brokenIds.has(entry.id)
            const imageAlt = entry.prompt || t('Generated image')
            return (
              <Card key={entry.id} className='overflow-hidden'>
                <div className='bg-muted relative aspect-square'>
                  {broken ? (
                    <div className='text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm'>
                      <History className='h-8 w-8' />
                      <span>{t('Image unavailable')}</span>
                    </div>
                  ) : (
                    <button
                      type='button'
                      className='h-full w-full cursor-zoom-in'
                      aria-label={t('Preview {{name}}', { name: imageAlt })}
                      onClick={() =>
                        setPreview({ src: entry.image, alt: imageAlt })
                      }
                    >
                      <img
                        src={entry.image}
                        alt={imageAlt}
                        loading='lazy'
                        decoding='async'
                        onError={() => handleImageError(entry.id)}
                        className='h-full w-full object-contain'
                      />
                    </button>
                  )}
                  <div className='absolute top-2 right-2 flex gap-1'>
                    {!broken && (
                      <Button
                        variant='secondary'
                        size='icon'
                        onClick={() => void handleDownload(entry)}
                        disabled={busyAction !== null}
                        aria-label={t('Download')}
                      >
                        {isBusy('download', entry.id) ? (
                          <Loader2 className='h-4 w-4 animate-spin' />
                        ) : (
                          <Download className='h-4 w-4' />
                        )}
                      </Button>
                    )}
                    <Button
                      variant='secondary'
                      size='icon-sm'
                      onClick={() => void handleDelete(entry)}
                      disabled={busyAction !== null}
                      aria-label={t('Delete')}
                    >
                      {isBusy('delete', entry.id) ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        <Trash2 className='h-4 w-4' />
                      )}
                    </Button>
                  </div>
                </div>
                <CardContent className='space-y-2 p-3'>
                  <div className='flex items-start gap-1'>
                    <p className='text-muted-foreground line-clamp-2 min-w-0 flex-1 text-xs'>
                      {entry.prompt || t('No prompt')}
                    </p>
                    {entry.prompt && (
                      <CopyButton
                        value={entry.prompt}
                        size='icon'
                        tooltip={t('Copy prompt')}
                      />
                    )}
                  </div>
                  <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[11px]'>
                    <span>{entry.model}</span>
                    <span>{entry.group}</span>
                    <span>{entry.size}</span>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  {entry.temporary && (
                    <p className='text-warning text-xs'>
                      {t('Temporary image link may expire.')}
                    </p>
                  )}
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        try {
                          sessionStorage.setItem(
                            getCanvasStorageKey(
                              STORAGE_KEYS.RESTORE,
                              userId ?? 0
                            ),
                            JSON.stringify({
                              userId,
                              prompt: entry.prompt,
                              model: entry.model,
                              group: entry.group,
                              size: entry.size,
                              n: entry.n,
                            })
                          )
                          void navigate({ to: '/canvas' })
                        } catch {
                          toast.error(t('Unable to prepare this prompt.'))
                        }
                      }}
                      disabled={busyAction !== null || !userId}
                    >
                      <RotateCcw className='h-3.5 w-3.5' />
                      {t('Reuse prompt')}
                    </Button>
                    {entry.temporary && (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() =>
                          window.open(
                            entry.image,
                            '_blank',
                            'noopener,noreferrer'
                          )
                        }
                        disabled={busyAction !== null}
                      >
                        <ExternalLink className='h-3.5 w-3.5' />
                        {t('Open original')}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ImagePreviewDialog
        src={preview?.src ?? null}
        alt={preview?.alt}
        onClose={() => setPreview(null)}
      />
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t('Clear drawing records?')}
        desc={t(
          'This action will permanently remove all saved drawing records.'
        )}
        confirmText={t('Clear')}
        destructive
        isLoading={clearLoading}
        handleConfirm={() => void handleClear()}
      />
    </div>
  )
}
