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
import { Loader2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import { API_KEY_STATUS, API_KEY_STATUSES } from '@/features/keys/constants'
import type { ApiKey } from '@/features/keys/types'
import { handleServerError } from '@/lib/handle-server-error'

interface ApiKeyImportCardProps {
  hasPendingRestore: boolean
  onImported: (apiKey: string, group: string) => void
  onGoToKeys: () => void
}

export function ApiKeyImportCard(props: ApiKeyImportCardProps) {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadKeys = async () => {
      setLoading(true)
      setLoadFailed(false)
      try {
        const result = await getApiKeys({ p: 1, size: 100 })
        if (cancelled) return
        if (!result.success) {
          setLoadFailed(true)
          return
        }
        setKeys(result.data?.items ?? [])
      } catch (error) {
        if (cancelled) return
        setLoadFailed(true)
        handleServerError(error, t('Failed to load API keys'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadKeys()
    return () => {
      cancelled = true
    }
  }, [reloadToken, t])

  const options = keys.map((key) => ({
    value: String(key.id),
    label:
      key.status === API_KEY_STATUS.ENABLED
        ? key.name
        : `${key.name} (${t(API_KEY_STATUSES[key.status]?.label ?? 'Disabled')})`,
    disabled: key.status !== API_KEY_STATUS.ENABLED,
  }))

  const handleSelectKey = async (nextId: string | null) => {
    if (!nextId || importing) return
    const key = keys.find((item) => String(item.id) === nextId)
    if (!key) return
    setSelectedId(nextId)
    setImporting(true)
    try {
      const result = await fetchTokenKey(key.id)
      if (!result.success || !result.data?.key) {
        handleServerError(result, t('Unable to import the API key to Canvas.'))
        setSelectedId(null)
        return
      }
      props.onImported(`sk-${result.data.key}`, key.group ?? '')
    } catch (error) {
      handleServerError(error, t('Unable to import the API key to Canvas.'))
      setSelectedId(null)
    } finally {
      setImporting(false)
    }
  }

  let content: ReactNode
  if (loading) {
    content = (
      <div className='text-muted-foreground flex items-center gap-2 text-sm'>
        <Loader2 className='h-4 w-4 animate-spin' />
        {t('Loading...')}
      </div>
    )
  } else if (loadFailed) {
    content = (
      <>
        <p className='text-muted-foreground text-sm'>
          {t('Failed to load API keys')}
        </p>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            onClick={() => setReloadToken((token) => token + 1)}
          >
            {t('Retry')}
          </Button>
          <Button variant='ghost' onClick={props.onGoToKeys}>
            {t('Go to API Keys')}
          </Button>
        </div>
      </>
    )
  } else if (keys.length === 0) {
    content = (
      <>
        <p className='text-muted-foreground text-sm'>
          {t(
            'No API keys available. Create your first API key to get started.'
          )}
        </p>
        <Button onClick={props.onGoToKeys}>{t('Create API Key')}</Button>
      </>
    )
  } else {
    content = (
      <>
        <div className='space-y-2'>
          <p className='text-muted-foreground text-sm'>
            {t('Select an API key to start generating images.')}
          </p>
          <Combobox
            options={options}
            value={selectedId}
            onValueChange={(next) => void handleSelectKey(next)}
            disabled={importing}
            placeholder={t('Select an API key')}
            aria-label={t('Select an API key')}
            className='w-full'
          />
        </div>
        <Button variant='outline' onClick={props.onGoToKeys}>
          {t('Go to API Keys')}
        </Button>
      </>
    )
  }

  return (
    <Card className='max-w-md'>
      <CardHeader>
        <CardTitle>{t('Canvas')}</CardTitle>
        <CardDescription>{t('No API key imported yet.')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {props.hasPendingRestore && (
          <p className='text-muted-foreground text-sm'>
            {t(
              'Your prompt is ready. Import an API key and it will be restored automatically.'
            )}
          </p>
        )}
        {content}
      </CardContent>
    </Card>
  )
}
