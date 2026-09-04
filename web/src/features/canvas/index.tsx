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
  Download,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
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
import { ComboboxInput } from '@/components/ui/combobox-input'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'

import {
  editImage,
  generateImages,
  getAvailableGroups,
  getAvailableModels,
} from './api'
import {
  DEFAULT_GROUP,
  DEFAULT_MODEL,
  getCanvasStorageKey,
  IMAGE_SIZES,
  STORAGE_KEYS,
} from './constants'
import {
  downloadImage,
  persistImageSource,
  saveHistoryEntries,
} from './lib/history'
import type { GroupOption, ImageResponse, ModelOption } from './types'

const MAX_REFERENCE_IMAGES = 4

function toImageSrc(item: NonNullable<ImageResponse['data']>[number]): string {
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item.url) return item.url
  return ''
}

function CanvasResults({
  loading,
  results,
  onPreview,
}: {
  loading: boolean
  results: string[]
  onPreview: (src: string) => void
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
        <img
          src={results[0]}
          alt={t('Generated image')}
          onClick={() => onPreview(results[0])}
          className='hover:border-border max-h-full max-w-full cursor-zoom-in rounded-xl border border-transparent object-contain transition'
        />
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
          <button
            type='button'
            onClick={() =>
              void handleDownload(src, `canvas-${Date.now()}-${index + 1}.png`)
            }
            disabled={downloadingSrc !== null}
            aria-label={t('Download')}
            className='bg-background/80 absolute top-2 right-2 rounded-md p-1.5 opacity-0 transition-opacity group-hover:opacity-100'
          >
            <Download className='h-4 w-4' />
          </button>
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
  const [size, setSize] = useState<string>('1024x1024')
  const [n, setN] = useState(1)
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setApiKey(null)
    setSessionUserId(null)
    setHasPendingRestore(false)
    setGroup(DEFAULT_GROUP)
    setModel(DEFAULT_MODEL)
    setSize('1024x1024')
    setN(1)
    setPrompt('')
    setFiles([])
    setGroups([])
    setModels([])
    setResults([])
    setError('')
    setPreviewSrc(null)

    let cancelled = false
    if (!userId) return () => undefined

    let key: string | null = null
    let savedGroup: string | null = null
    try {
      key = sessionStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.API_KEY, userId)
      )
      savedGroup = sessionStorage.getItem(
        getCanvasStorageKey(STORAGE_KEYS.GROUP, userId)
      )
    } catch {
      // Private browsing can block session storage; Canvas remains usable after import.
    }
    setApiKey(key)
    setSessionUserId(userId)
    if (savedGroup) setGroup(savedGroup)
    getAvailableGroups()
      .then((nextGroups) => {
        if (!cancelled) setGroups(nextGroups)
      })
      .catch(() => undefined)

    const restoreKey = getCanvasStorageKey(STORAGE_KEYS.RESTORE, userId)
    let restore: string | null = null
    try {
      restore = sessionStorage.getItem(restoreKey)
    } catch {
      restore = null
    }
    if (restore) {
      try {
        const data = JSON.parse(restore) as {
          userId?: number
          prompt?: string
          model?: string
          group?: string
          size?: string
          n?: number
        }
        if (data.userId !== userId) {
          sessionStorage.removeItem(restoreKey)
        } else {
          if (typeof data.prompt === 'string') setPrompt(data.prompt)
          if (typeof data.model === 'string') setModel(data.model)
          if (typeof data.group === 'string') setGroup(data.group)
          if (typeof data.size === 'string') setSize(data.size)
          if (
            typeof data.n === 'number' &&
            Number.isInteger(data.n) &&
            data.n >= 1 &&
            data.n <= 4
          ) {
            setN(data.n)
          }
          setHasPendingRestore(!key)
          if (key) sessionStorage.removeItem(restoreKey)
        }
      } catch {
        try {
          sessionStorage.removeItem(restoreKey)
        } catch {
          // Ignore malformed or unavailable restore storage.
        }
      }
    }
    return () => {
      cancelled = true
    }
  }, [userId])

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
    setLoading(true)
    setError('')
    setResults([])
    try {
      const response =
        files.length > 0
          ? await editImage(
              { model, prompt: prompt.trim(), size, n, images: files },
              apiKey
            )
          : await generateImages(
              { model, prompt: prompt.trim(), size, n },
              apiKey
            )
      const images = await Promise.all(
        (response.data ?? [])
          .map(toImageSrc)
          .filter(Boolean)
          .map(persistImageSource)
      )
      setResults(images.map((item) => item.image))
      const now = Date.now()
      const saveResult = await saveHistoryEntries(
        userId,
        images.map((item, index) => ({
          id: `${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          image: item.image,
          temporary: item.temporary,
          prompt: prompt.trim(),
          model,
          group,
          size,
          n,
          createdAt: now,
        }))
      )
      if (!saveResult.success) {
        toast.error(t('Image generated, but it could not be saved to history.'))
      }
      if (images.some((item) => item.temporary)) {
        toast.warning(t('This image is temporary and may expire.'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  if (!apiKey || sessionUserId !== userId) {
    return (
      <Main className='p-0'>
        <div className='flex min-h-[60vh] items-center justify-center p-8'>
          <Card className='max-w-md'>
            <CardHeader>
              <CardTitle>{t('Canvas')}</CardTitle>
              <CardDescription>{t('No API key imported yet.')}</CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Import an API key from the API Keys page to start generating images.'
                )}
              </p>
              {hasPendingRestore && (
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Your prompt is ready. Import an API key and it will be restored automatically.'
                  )}
                </p>
              )}
              <Button onClick={() => navigate({ to: '/keys' })}>
                {t('Go to API Keys')}
              </Button>
            </CardContent>
          </Card>
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
      <div className='flex h-full flex-col overflow-hidden'>
        <div className='border-border flex items-center justify-between border-b px-6 py-4'>
          <div className='flex items-center gap-2'>
            <ImageIcon className='text-primary h-5 w-5' />
            <h1 className='text-lg font-semibold'>{t('Canvas')}</h1>
          </div>
          <span className='text-muted-foreground text-xs'>
            {t('Using imported API key')}
          </span>
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

              <div className='grid grid-cols-2 gap-3'>
                <div className='space-y-2'>
                  <label className='text-sm font-medium'>{t('Size')}</label>
                  <ComboboxInput
                    className='w-full'
                    options={sizeOptions}
                    value={size}
                    onValueChange={(value) => setSize(value)}
                    placeholder={t('Select a size')}
                    emptyText={t('No size found.')}
                  />
                </div>
                <div className='space-y-2'>
                  <label className='text-sm font-medium'>{t('Count')}</label>
                  <Input
                    type='number'
                    min={1}
                    max={4}
                    value={n}
                    onChange={(event) =>
                      setN(
                        Math.max(
                          1,
                          Math.min(4, Number(event.target.value) || 1)
                        )
                      )
                    }
                  />
                </div>
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
                onClick={handleGenerate}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Sparkles className='h-4 w-4' />
                )}
                {loading ? t('Generating...') : t('Generate')}
              </Button>
            </CardContent>
          </Card>

          <div className='flex min-h-0 flex-1 flex-col'>
            <div className='mb-4 flex items-center gap-2'>
              <ImagePlus className='text-muted-foreground h-5 w-5' />
              <h2 className='text-base font-semibold'>{t('Result')}</h2>
            </div>
            <div className='min-h-0 flex-1'>
              <CanvasResults
                loading={loading}
                results={results}
                onPreview={setPreviewSrc}
              />
            </div>
          </div>
        </div>
      </div>
      <ImagePreviewDialog
        src={previewSrc}
        onClose={() => setPreviewSrc(null)}
      />
    </Main>
  )
}
