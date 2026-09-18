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
  AlertCircle,
  ChevronDown,
  Download,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ImagePreviewDialog } from '@/components/image-preview-dialog'
import { Main } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Card,
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
import { ComboboxInput } from '@/components/ui/combobox-input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  editImage,
  generateImages,
  getAvailableGroups,
  getAvailableModels,
} from './api'
import { ApiKeyImportCard } from './components/api-key-import-card'
import {
  ASPECT_RATIO_VALUES,
  COUNT_MAX,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_COUNT,
  DEFAULT_GROUP,
  DEFAULT_MODEL,
  DEFAULT_RESOLUTION,
  getCanvasStorageKey,
  IMAGE_SIZES,
  RESOLUTIONS,
  STORAGE_KEYS,
} from './constants'
import {
  downloadImage,
  loadHistory,
  persistImageSource,
  saveHistoryEntries,
} from './lib/history'
import { getImageSize, parseImageSize } from './lib/size'
import type { GroupOption, ImageResponse, ModelOption } from './types'

const MAX_REFERENCE_IMAGES = 4

type CanvasRestorePayload = {
  userId?: number
  prompt?: string
  model?: string
  group?: string
  size?: string
  n?: number
}

function toImageSrc(item: NonNullable<ImageResponse['data']>[number]): string {
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item.url) return item.url
  return ''
}

function CanvasResults({
  loading,
  results,
  onPreview,
  onUseAsReference,
  referenceLoadingSrc,
}: {
  loading: boolean
  results: string[]
  onPreview: (src: string) => void
  onUseAsReference: (src: string) => void
  referenceLoadingSrc: string | null
}) {
  const { t } = useTranslation()
  const [downloadingSrc, setDownloadingSrc] = useState<string | null>(null)

  const handleDownload = async (src: string, filename: string) => {
    if (downloadingSrc) return
    setDownloadingSrc(src)
    try {
      const success = await downloadImage(src, filename)
      if (!success) {
        toast.error(t('Download failed. Try opening the original image.'))
      }
    } finally {
      setDownloadingSrc(null)
    }
  }

  const renderActions = (src: string, index: number) => (
    <div className='absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
      <button
        type='button'
        onClick={() => onUseAsReference(src)}
        disabled={referenceLoadingSrc !== null}
        aria-label={t('Use as reference image')}
        className='bg-background/80 rounded-md p-1.5'
      >
        {referenceLoadingSrc === src ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <ImagePlus className='h-4 w-4' />
        )}
      </button>
      <button
        type='button'
        onClick={() =>
          void handleDownload(src, `canvas-${Date.now()}-${index + 1}.png`)
        }
        disabled={downloadingSrc !== null}
        aria-label={t('Download')}
        className='bg-background/80 rounded-md p-1.5'
      >
        {downloadingSrc === src ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <Download className='h-4 w-4' />
        )}
      </button>
    </div>
  )

  if (loading) {
    return (
      <div className='flex h-full min-h-40 items-center justify-center'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
      </div>
    )
  }
  if (results.length === 0) {
    return (
      <div className='border-border text-muted-foreground flex h-full min-h-40 items-center justify-center rounded-xl border text-sm'>
        {t('Generated images will appear here.')}
      </div>
    )
  }
  if (results.length === 1) {
    return (
      <div className='flex h-full min-h-40 items-center justify-center overflow-auto'>
        <div className='group relative h-full w-full'>
          <img
            src={results[0]}
            alt={t('Generated image')}
            onClick={() => onPreview(results[0])}
            className='h-full w-full cursor-zoom-in object-contain'
          />
          {renderActions(results[0], 0)}
        </div>
      </div>
    )
  }
  return (
    <div className='grid grid-cols-2 gap-4 overflow-auto xl:grid-cols-3'>
      {results.map((src, index) => (
        <div
          key={src}
          className='group border-border relative overflow-hidden rounded-xl border'
        >
          <img
            src={src}
            alt={`${t('Generated image')} ${index + 1}`}
            onClick={() => onPreview(src)}
            className='h-full w-full cursor-zoom-in object-contain'
          />
          {renderActions(src, index)}
        </div>
      ))}
    </div>
  )
}

export function Canvas() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [sessionUserId, setSessionUserId] = useState<number | null>(null)
  const [group, setGroup] = useState(DEFAULT_GROUP)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [aspectRatio, setAspectRatio] = useState<string>(DEFAULT_ASPECT_RATIO)
  const [resolution, setResolution] = useState<string>(DEFAULT_RESOLUTION)
  const [customSize, setCustomSize] = useState('')
  const [customSizeOpen, setCustomSizeOpen] = useState(false)
  const [n, setN] = useState(DEFAULT_COUNT)
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [previewUrls, setPreviewUrls] = useState<string[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [results, setResults] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [hasPendingRestore, setHasPendingRestore] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [referenceLoadingSrc, setReferenceLoadingSrc] = useState<string | null>(
    null
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const settingsHydratedRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setApiKey(null)
    setSessionUserId(null)
    setHasPendingRestore(false)
    setGroup(DEFAULT_GROUP)
    setModel(DEFAULT_MODEL)
    setAspectRatio(DEFAULT_ASPECT_RATIO)
    setResolution(DEFAULT_RESOLUTION)
    setCustomSize('')
    setN(DEFAULT_COUNT)
    setPrompt('')
    setFiles([])
    setGroups([])
    setModels([])
    setResults([])
    setError('')
    setPreviewSrc(null)
    setDownloadingAll(false)
    setReferenceLoadingSrc(null)
    settingsHydratedRef.current = false

    let cancelled = false
    if (!userId) return () => undefined

    let key: string | null = null
    let savedGroup: string | null = null
    let savedModel: string | null = null
    let savedPrompt: string | null = null
    let savedAspectRatio: string | null = null
    let savedResolution: string | null = null
    let savedCount: string | null = null
    let lastBatchIds: string[] = []
    try {
      key = sessionStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.API_KEY, userId)
      )
      savedPrompt = sessionStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.PROMPT, userId)
      )
      savedGroup =
        sessionStorage.getItem(
          getCanvasStorageKey(STORAGE_KEYS.GROUP, userId)
        ) ??
        localStorage.getItem(getCanvasStorageKey(STORAGE_KEYS.GROUP, userId))
      savedModel = localStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.MODEL, userId)
      )
      savedAspectRatio = localStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.ASPECT_RATIO, userId)
      )
      savedResolution = localStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.RESOLUTION, userId)
      )
      savedCount = localStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.COUNT, userId)
      )
      const rawBatch = localStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.LAST_BATCH, userId)
      )
      if (rawBatch) {
        const parsed = JSON.parse(rawBatch) as { ids?: unknown }
        if (Array.isArray(parsed.ids)) {
          lastBatchIds = parsed.ids.filter(
            (id): id is string => typeof id === 'string'
          )
        }
      }
    } catch {
      // Unavailable storage must not block Canvas; defaults remain in place.
    }
    setApiKey(key)
    setSessionUserId(userId)
    if (savedGroup) setGroup(savedGroup)
    if (savedModel) setModel(savedModel)
    if (savedPrompt) setPrompt(savedPrompt)
    if (
      savedAspectRatio &&
      (ASPECT_RATIO_VALUES as readonly string[]).includes(savedAspectRatio)
    ) {
      setAspectRatio(savedAspectRatio)
    }
    if (
      savedResolution &&
      RESOLUTIONS.some((item) => item.value === savedResolution)
    ) {
      setResolution(savedResolution)
    }
    const restoredCount = Number(savedCount)
    if (
      Number.isInteger(restoredCount) &&
      restoredCount >= 1 &&
      restoredCount <= COUNT_MAX
    ) {
      setN(restoredCount)
    }
    settingsHydratedRef.current = true
    getAvailableGroups()
      .then((nextGroups) => {
        if (!cancelled) setGroups(nextGroups)
      })
      .catch(() => undefined)

    if (lastBatchIds.length > 0) {
      loadHistory(userId)
        .then((entries) => {
          if (cancelled) return
          const imagesById = new Map(
            entries.map((entry) => [entry.id, entry.image])
          )
          const images = lastBatchIds
            .map((id) => imagesById.get(id))
            .filter((image): image is string => typeof image === 'string')
          if (images.length > 0) setResults(images)
        })
        .catch(() => undefined)
    }

    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!userId || sessionUserId !== userId) return
    const restoreKey = getCanvasStorageKey(STORAGE_KEYS.RESTORE, userId)
    let restore: string | null = null
    try {
      restore = sessionStorage.getItem(restoreKey)
    } catch {
      return
    }
    if (!restore) return
    if (!apiKey) {
      setHasPendingRestore(true)
      return
    }

    const clearRestore = () => {
      try {
        sessionStorage.removeItem(restoreKey)
      } catch {
        // Ignore malformed or unavailable restore storage.
      }
    }

    let data: CanvasRestorePayload
    try {
      data = JSON.parse(restore) as CanvasRestorePayload
      if (data.userId !== userId) {
        clearRestore()
        return
      }
    } catch {
      clearRestore()
      return
    }

    if (typeof data.prompt === 'string') setPrompt(data.prompt)
    if (typeof data.model === 'string') setModel(data.model)
    if (typeof data.group === 'string') setGroup(data.group)
    if (typeof data.size === 'string' && data.size.trim() !== '') {
      const parsedSize = parseImageSize(data.size)
      if (parsedSize) {
        setAspectRatio(parsedSize.aspectRatio)
        setResolution(parsedSize.resolution)
        setCustomSize('')
      } else {
        setCustomSize(data.size)
        setCustomSizeOpen(true)
      }
    }
    if (
      typeof data.n === 'number' &&
      Number.isInteger(data.n) &&
      data.n >= 1 &&
      data.n <= COUNT_MAX
    ) {
      setN(data.n)
    }
    setHasPendingRestore(false)
    clearRestore()
  }, [apiKey, sessionUserId, userId])

  useEffect(() => {
    if (!settingsHydratedRef.current || !userId) return
    try {
      localStorage.setItem(
        getCanvasStorageKey(STORAGE_KEYS.GROUP, userId),
        group
      )
      localStorage.setItem(
        getCanvasStorageKey(STORAGE_KEYS.MODEL, userId),
        model
      )
      localStorage.setItem(
        getCanvasStorageKey(STORAGE_KEYS.ASPECT_RATIO, userId),
        aspectRatio
      )
      localStorage.setItem(
        getCanvasStorageKey(STORAGE_KEYS.RESOLUTION, userId),
        resolution
      )
      localStorage.setItem(
        getCanvasStorageKey(STORAGE_KEYS.COUNT, userId),
        String(n)
      )
    } catch {
      // Ignore unavailable local storage; the workspace stays usable.
    }
  }, [aspectRatio, group, model, n, resolution, userId])

  useEffect(() => {
    if (!settingsHydratedRef.current || !userId) return
    const timer = window.setTimeout(() => {
      try {
        const key = getCanvasStorageKey(STORAGE_KEYS.PROMPT, userId)
        if (prompt) sessionStorage.setItem(key, prompt)
        else sessionStorage.removeItem(key)
      } catch {
        // Ignore unavailable session storage.
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [prompt, userId])

  useEffect(() => {
    if (!userId || !group) return () => undefined
    let cancelled = false
    getAvailableModels(group)
      .then((list) => {
        if (!cancelled) setModels(list)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [group, userId])

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviewUrls(urls)
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [files])

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_REFERENCE_IMAGES))
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])]
    addFiles(selected)
    event.target.value = ''
  }

  const handlePaste: React.ClipboardEventHandler<HTMLDivElement> = (event) => {
    const items = event.clipboardData?.items
    if (!items) return
    const pasted: File[] = []
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) pasted.push(file)
      }
    }
    if (pasted.length > 0) {
      event.preventDefault()
      addFiles(pasted)
    }
  }

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault()
    addFiles([...(event.dataTransfer?.files ?? [])])
  }

  const removeFile = (file: File) => {
    setFiles((prev) => prev.filter((item) => item !== file))
  }

  const handleImportedKey = (importedKey: string, importedGroup: string) => {
    if (!userId || sessionUserId !== userId) return
    try {
      sessionStorage.setItem(
        getCanvasStorageKey(STORAGE_KEYS.API_KEY, userId),
        importedKey
      )
      sessionStorage.setItem(
        getCanvasStorageKey(STORAGE_KEYS.GROUP, userId),
        importedGroup
      )
    } catch {
      toast.error(t('Unable to import the API key to Canvas.'))
      return
    }
    setApiKey(importedKey)
    if (importedGroup) setGroup(importedGroup)
    toast.success(t('Imported to Canvas'))
  }

  const handleSwitchKey = () => {
    if (!userId) return
    try {
      sessionStorage.removeItem(
        getCanvasStorageKey(STORAGE_KEYS.API_KEY, userId)
      )
    } catch {
      // Ignore unavailable session storage; clearing state switches the key.
    }
    setApiKey(null)
  }

  const handleUseAsReference = async (src: string) => {
    if (referenceLoadingSrc !== null) return
    if (files.length >= MAX_REFERENCE_IMAGES) {
      toast.warning(t('Reference image limit reached.'))
      return
    }
    setReferenceLoadingSrc(src)
    try {
      const response = await fetch(src)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const extension = blob.type === 'image/jpeg' ? 'jpg' : 'png'
      const file = new File(
        [blob],
        `canvas-reference-${Date.now()}.${extension}`,
        { type: blob.type || 'image/png' }
      )
      setFiles((prev) => [...prev, file].slice(0, MAX_REFERENCE_IMAGES))
      toast.success(t('Added to reference images.'))
    } catch {
      toast.error(t('Unable to use this image as a reference.'))
    } finally {
      setReferenceLoadingSrc(null)
    }
  }

  const handleDownloadAll = async () => {
    if (downloadingAll || results.length === 0) return
    setDownloadingAll(true)
    try {
      for (const [index, src] of results.entries()) {
        const success = await downloadImage(
          src,
          `canvas-${Date.now()}-${index + 1}.png`
        )
        if (!success) {
          toast.error(t('Download failed. Try opening the original image.'))
          break
        }
        await new Promise((resolve) => window.setTimeout(resolve, 300))
      }
    } finally {
      setDownloadingAll(false)
    }
  }

  const showRelativePreview = (offset: number) => {
    if (results.length === 0 || previewSrc === null) return
    const currentIndex = results.indexOf(previewSrc)
    if (currentIndex < 0) return
    const nextIndex = (currentIndex + offset + results.length) % results.length
    setPreviewSrc(results[nextIndex])
  }

  const handleShortcutKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (
    event
  ) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
    event.preventDefault()
    if (!loading) void handleGenerate()
  }

  const effectiveSize =
    customSize.trim() !== ''
      ? customSize.trim()
      : getImageSize(aspectRatio, resolution)

  const handleGenerate = async () => {
    if (!apiKey || !userId || sessionUserId !== userId) {
      setError(t('Please import an API key first.'))
      return
    }
    if (model.trim() === '') {
      setError(t('Please select or enter a model.'))
      return
    }
    if (prompt.trim() === '') {
      setError(t('Enter a prompt.'))
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError('')
    setResults([])
    try {
      const response =
        files.length > 0
          ? await editImage(
              {
                model,
                prompt: prompt.trim(),
                size: effectiveSize,
                n,
                images: files,
              },
              apiKey,
              controller.signal
            )
          : await generateImages(
              { model, prompt: prompt.trim(), size: effectiveSize, n },
              apiKey,
              controller.signal
            )
      const images = await Promise.all(
        (response.data ?? [])
          .map(toImageSrc)
          .filter(Boolean)
          .map(persistImageSource)
      )
      setResults(images.map((item) => item.image))
      const now = Date.now()
      const entries = images.map((item, index) => ({
        id: `${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
        image: item.image,
        temporary: item.temporary,
        prompt: prompt.trim(),
        model,
        group,
        size: effectiveSize ?? '',
        n,
        createdAt: now,
      }))
      const saveResult = await saveHistoryEntries(userId, entries)
      if (!saveResult.success) {
        toast.error(t('Image generated, but it could not be saved to history.'))
      } else if (entries.length > 0) {
        try {
          localStorage.setItem(
            getCanvasStorageKey(STORAGE_KEYS.LAST_BATCH, userId),
            JSON.stringify({
              ids: entries.map((entry) => entry.id),
              createdAt: now,
            })
          )
        } catch {
          // Restoring the last batch is best-effort when storage is blocked.
        }
      }
      if (images.some((item) => item.temporary)) {
        toast.warning(t('This image is temporary and may expire.'))
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
    }
  }

  const handleCancelGenerate = () => {
    abortRef.current?.abort()
  }

  if (!apiKey || sessionUserId !== userId) {
    return (
      <Main className='p-0'>
        <div className='flex min-h-[60vh] items-center justify-center p-8'>
          <ApiKeyImportCard
            hasPendingRestore={hasPendingRestore}
            onImported={handleImportedKey}
            onGoToKeys={() => navigate({ to: '/keys' })}
          />
        </div>
      </Main>
    )
  }

  const groupOptions = groups.map((item) => ({
    value: item.name,
    label: item.desc ? `${item.name} (${item.desc})` : item.name,
  }))
  const modelOptions = models.map((item) => ({
    value: item.name,
    label: item.name,
  }))
  const sizeOptions = IMAGE_SIZES.map((item) => ({
    value: item,
    label: item,
  }))

  return (
    <Main className='p-0'>
      <div
        className='flex h-full flex-col overflow-hidden'
        onKeyDown={handleShortcutKeyDown}
      >
        <div className='border-border flex items-center justify-between border-b px-6 py-4'>
          <div className='flex items-center gap-2'>
            <ImageIcon className='text-primary h-5 w-5' />
            <h1 className='text-lg font-semibold'>{t('Canvas')}</h1>
          </div>
          <div className='flex items-center gap-2'>
            <span className='text-muted-foreground text-xs'>
              {t('Using imported API key')}
            </span>
            <Button
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={handleSwitchKey}
            >
              {t('Switch API Key')}
            </Button>
          </div>
        </div>

        <div className='flex min-h-0 flex-1 gap-6 overflow-auto p-6'>
          <Card className='w-full max-w-md shrink-0 self-start'>
            <CardHeader>
              <CardTitle>{t('Generate Image')}</CardTitle>
              <CardDescription>
                {t('Text to image or reference image editing.')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div className='space-y-2'>
                <label className='text-sm font-medium'>{t('Group')}</label>
                <ComboboxInput
                  className='w-full'
                  options={groupOptions}
                  value={group}
                  onValueChange={(value) => setGroup(value)}
                  placeholder={t('Select a group')}
                  emptyText={t('No group found.')}
                />
              </div>

              <div className='space-y-2'>
                <label className='text-sm font-medium'>{t('Model')}</label>
                <ComboboxInput
                  className='w-full'
                  options={modelOptions}
                  value={model}
                  onValueChange={(value) => setModel(value)}
                  allowCustomValue
                  placeholder={t('Type or select a model')}
                  emptyText={t('No model found.')}
                />
              </div>

              <div className='space-y-2'>
                <label className='text-sm font-medium'>{t('Prompt')}</label>
                <Textarea
                  rows={4}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={t('Describe the image you want to create...')}
                />
              </div>

              <div className='space-y-2'>
                <label className='text-sm font-medium'>
                  {t('Aspect Ratio')}
                </label>
                <ToggleGroup
                  value={[aspectRatio]}
                  onValueChange={(values) => {
                    if (values.length > 0) setAspectRatio(values[0])
                  }}
                  variant='outline'
                  size='sm'
                  className='flex-wrap'
                  aria-label={t('Aspect Ratio')}
                >
                  {ASPECT_RATIO_VALUES.map((value) => (
                    <ToggleGroupItem key={value} value={value}>
                      {value === 'auto' ? t('Auto') : value}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className='space-y-2'>
                <label className='text-sm font-medium'>{t('Resolution')}</label>
                <ToggleGroup
                  value={[resolution]}
                  onValueChange={(values) => {
                    if (values.length > 0) setResolution(values[0])
                  }}
                  variant='outline'
                  size='sm'
                  disabled={aspectRatio === 'auto'}
                  className='flex-wrap'
                  aria-label={t('Resolution')}
                >
                  {RESOLUTIONS.map((item) => (
                    <ToggleGroupItem key={item.value} value={item.value}>
                      {item.value}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className='text-muted-foreground text-xs'>
                  {t('Actual size')}:{' '}
                  {effectiveSize
                    ? effectiveSize.replace('x', ' × ')
                    : t('Determined by model')}
                </p>
              </div>

              <Collapsible
                open={customSizeOpen}
                onOpenChange={setCustomSizeOpen}
              >
                <CollapsibleTrigger
                  render={
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='-ml-2 h-7 gap-1 px-2 text-xs'
                    />
                  }
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform',
                      customSizeOpen && 'rotate-180'
                    )}
                  />
                  {t('Custom size')}
                  {customSize && (
                    <span className='text-muted-foreground'>
                      ({customSize})
                    </span>
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className='space-y-2 pt-2'>
                  <ComboboxInput
                    className='w-full'
                    options={sizeOptions}
                    value={customSize}
                    onValueChange={(value) => setCustomSize(value)}
                    placeholder={t('Select a size')}
                    emptyText={t('No size found.')}
                  />
                  {customSize && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-7 px-2 text-xs'
                      onClick={() => setCustomSize('')}
                    >
                      {t('Clear custom size')}
                    </Button>
                  )}
                </CollapsibleContent>
              </Collapsible>

              <div className='space-y-2'>
                <label className='text-sm font-medium'>{t('Quantity')}</label>
                <InputGroup className='w-full'>
                  <InputGroupAddon align='inline-start'>
                    <InputGroupButton
                      size='icon-xs'
                      onClick={() => setN((prev) => Math.max(1, prev - 1))}
                      disabled={n <= 1}
                      aria-label={t('Decrease')}
                    >
                      <Minus />
                    </InputGroupButton>
                  </InputGroupAddon>
                  <InputGroupInput
                    type='number'
                    min={1}
                    max={COUNT_MAX}
                    value={n}
                    aria-label={t('Quantity')}
                    className='text-center tabular-nums'
                    onChange={(event) =>
                      setN(
                        Math.max(
                          1,
                          Math.min(COUNT_MAX, Number(event.target.value) || 1)
                        )
                      )
                    }
                  />
                  <InputGroupAddon align='inline-end'>
                    <InputGroupButton
                      size='icon-xs'
                      onClick={() =>
                        setN((prev) => Math.min(COUNT_MAX, prev + 1))
                      }
                      disabled={n >= COUNT_MAX}
                      aria-label={t('Increase')}
                    >
                      <Plus />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </div>

              <div className='space-y-2'>
                <label className='text-sm font-medium'>
                  {t('Reference Image')}
                </label>
                <div
                  role='button'
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  onPaste={handlePaste}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                  className='border-border text-muted-foreground hover:border-primary/60 hover:text-foreground flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center text-xs transition-colors'
                >
                  <ImagePlus className='h-5 w-5' />
                  <span>{t('Click, drop, or paste images here')}</span>
                </div>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  multiple
                  className='hidden'
                  onChange={handleFileChange}
                />
                {previewUrls.length > 0 && (
                  <div className='grid grid-cols-3 gap-2'>
                    {previewUrls.map((url, index) => {
                      const file = files[index]
                      return (
                        <div
                          key={url}
                          className='group relative aspect-square overflow-hidden rounded-lg border'
                        >
                          <img
                            src={url}
                            alt={file?.name ?? t('Reference Image')}
                            className='h-full w-full object-cover'
                          />
                          <button
                            type='button'
                            onClick={() => removeFile(file)}
                            aria-label={t('Remove')}
                            className='bg-background/80 absolute top-1 right-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100'
                          >
                            <X className='h-3 w-3' />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {files.length > 0 && (
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      '{{count}} image(s) selected. The first image is used as a reference.',
                      { count: files.length }
                    )}
                  </p>
                )}
              </div>

              {error && (
                <div className='text-destructive flex items-start gap-2 text-sm'>
                  <AlertCircle className='mt-0.5 h-4 w-4' />
                  <span>{error}</span>
                </div>
              )}

              <Button
                className='w-full'
                onClick={() => void handleGenerate()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Sparkles className='h-4 w-4' />
                )}
                {loading ? t('Generating...') : t('Generate')}
              </Button>
              {loading ? (
                <Button
                  type='button'
                  variant='outline'
                  className='w-full'
                  onClick={handleCancelGenerate}
                >
                  {t('Cancel')}
                </Button>
              ) : (
                <p className='text-muted-foreground text-center text-xs'>
                  <kbd className='bg-muted rounded border px-1 py-0.5 font-mono'>
                    Ctrl/⌘
                  </kbd>{' '}
                  +{' '}
                  <kbd className='bg-muted rounded border px-1 py-0.5 font-mono'>
                    Enter
                  </kbd>
                </p>
              )}
            </CardContent>
          </Card>

          <div className='flex min-h-0 flex-1 flex-col'>
            <div className='mb-4 flex items-center gap-2'>
              <ImagePlus className='text-muted-foreground h-5 w-5' />
              <h2 className='text-base font-semibold'>{t('Result')}</h2>
              <div className='ml-auto flex items-center gap-2'>
                {results.length > 0 && !loading && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => void handleGenerate()}
                  >
                    <RotateCcw className='h-3.5 w-3.5' />
                    {t('Generate again')}
                  </Button>
                )}
                {results.length > 1 && !loading && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => void handleDownloadAll()}
                    disabled={downloadingAll}
                  >
                    {downloadingAll ? (
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                    ) : (
                      <Download className='h-3.5 w-3.5' />
                    )}
                    {t('Download all')}
                  </Button>
                )}
              </div>
            </div>
            <div className='min-h-0 flex-1'>
              <CanvasResults
                loading={loading}
                results={results}
                onPreview={setPreviewSrc}
                onUseAsReference={(src) => void handleUseAsReference(src)}
                referenceLoadingSrc={referenceLoadingSrc}
              />
            </div>
          </div>
        </div>
      </div>
      <ImagePreviewDialog
        src={previewSrc}
        onClose={() => setPreviewSrc(null)}
        onPrevious={
          results.length > 1 ? () => showRelativePreview(-1) : undefined
        }
        onNext={results.length > 1 ? () => showRelativePreview(1) : undefined}
      />
    </Main>
  )
}
