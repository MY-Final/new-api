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
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { t } from 'i18next'
import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { API_KEY_STATUS } from '@/features/keys/constants'
import { handleServerError } from '@/lib/handle-server-error'

import {
  filterModelsForKey,
  loadModelsForGroup,
  loadPlatformApiKeys,
  normalizeOpenAIBaseUrl,
} from '../api'
import type { ConnectionConfig } from '../types'

const customConnectionSchema = z.object({
  name: z.string().trim().min(1, t('Connection name is required')),
  baseUrl: z
    .string()
    .trim()
    .min(1, t('API address is required'))
    .refine((value) => {
      try {
        normalizeOpenAIBaseUrl(value)
        return true
      } catch {
        return false
      }
    }, t('Enter a valid HTTPS OpenAI-compatible API address')),
  model: z.string().trim().min(1, t('Model ID is required')),
  apiKey: z.string().trim().min(1, t('API Key is required')),
})

type CustomConnectionFormValues = z.infer<typeof customConnectionSchema>

const CUSTOM_CONNECTION_FORM_ID = 'intelligence-custom-connection-form'

interface ConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUseConnection: (connection: ConnectionConfig) => void
}

export function ConnectionDialog(props: ConnectionDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'platform' | 'custom'>('platform')
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  const customForm = useForm<CustomConnectionFormValues>({
    resolver: zodResolver(customConnectionSchema),
    defaultValues: {
      name: '',
      baseUrl: '',
      model: '',
      apiKey: '',
    },
  })

  const keysQuery = useQuery({
    queryKey: ['intelligence-test-api-keys'],
    queryFn: loadPlatformApiKeys,
    enabled: props.open,
  })

  const enabledKeys = useMemo(
    () =>
      (keysQuery.data ?? []).filter(
        (key) => key.status === API_KEY_STATUS.ENABLED
      ),
    [keysQuery.data]
  )
  const selectedKey =
    enabledKeys.find((key) => String(key.id) === selectedKeyId) ?? null

  const modelsQuery = useQuery({
    queryKey: [
      'intelligence-test-models',
      selectedKey?.id ?? 0,
      selectedKey?.group ?? '',
    ],
    queryFn: () => loadModelsForGroup(selectedKey?.group ?? ''),
    enabled: props.open && Boolean(selectedKey),
  })

  const platformModels = useMemo(
    () =>
      selectedKey
        ? filterModelsForKey(modelsQuery.data ?? [], selectedKey)
        : [],
    [modelsQuery.data, selectedKey]
  )

  useEffect(() => {
    if (!props.open) return
    if (!selectedKeyId && enabledKeys[0]) {
      setSelectedKeyId(String(enabledKeys[0].id))
    }
  }, [enabledKeys, props.open, selectedKeyId])

  useEffect(() => {
    if (!selectedModel || !platformModels.includes(selectedModel)) {
      setSelectedModel(platformModels[0] ?? null)
    }
  }, [platformModels, selectedModel])

  useEffect(() => {
    if (props.open) return
    customForm.reset()
    setTab('platform')
    setSelectedKeyId(null)
    setSelectedModel(null)
  }, [customForm, props.open])

  useEffect(() => {
    if (keysQuery.isError) {
      handleServerError(keysQuery.error, t('Failed to load API keys'))
    }
  }, [keysQuery.error, keysQuery.isError, t])

  useEffect(() => {
    if (modelsQuery.isError) {
      handleServerError(
        modelsQuery.error,
        t('Failed to load playground models')
      )
    }
  }, [modelsQuery.error, modelsQuery.isError, t])

  const keyOptions = enabledKeys.map((key) => ({
    value: String(key.id),
    label: key.name,
    description: key.group || t('Default group'),
  }))

  const modelOptions = platformModels.map((model) => ({
    value: model,
    label: model,
  }))

  const handlePlatformConnection = () => {
    if (!selectedKey || !selectedModel) return
    const connection: ConnectionConfig = {
      kind: 'platform',
      keyId: selectedKey.id,
      keyName: selectedKey.name,
      group: selectedKey.group ?? '',
      model: selectedModel,
    }
    props.onUseConnection(connection)
    props.onOpenChange(false)
  }

  const handleCustomConnection = (values: CustomConnectionFormValues) => {
    const connection: ConnectionConfig = {
      kind: 'custom',
      name: values.name,
      baseUrl: normalizeOpenAIBaseUrl(values.baseUrl),
      model: values.model,
      apiKey: values.apiKey,
    }
    props.onUseConnection(connection)
    props.onOpenChange(false)
  }

  let platformContent = null
  if (keysQuery.isLoading) {
    platformContent = (
      <div className='text-muted-foreground flex items-center gap-2 py-6 text-sm'>
        <Loader2 className='size-4 animate-spin' />
        {t('Loading...')}
      </div>
    )
  } else if (enabledKeys.length === 0) {
    platformContent = (
      <Alert>
        <AlertTitle>{t('No enabled API keys')}</AlertTitle>
        <AlertDescription className='space-y-3'>
          <p>{t('Create or enable an API key before running the test.')}</p>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              props.onOpenChange(false)
              void navigate({ to: '/keys' })
            }}
          >
            {t('Go to API Keys')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  } else {
    platformContent = (
      <div className='space-y-4'>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('Platform Key')}</p>
          <Combobox
            options={keyOptions}
            value={selectedKeyId}
            onValueChange={setSelectedKeyId}
            placeholder={t('Select an API key')}
            aria-label={t('Select an API key')}
            className='w-full'
          />
        </div>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>{t('Available models')}</p>
          <Combobox
            options={modelOptions}
            value={selectedModel}
            onValueChange={setSelectedModel}
            placeholder={t('Select Model')}
            aria-label={t('Select Model')}
            disabled={modelsQuery.isLoading || modelOptions.length === 0}
            emptyText={t('No models available.')}
            className='w-full'
          />
        </div>
      </div>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Choose a test model')}
      description={t(
        'The selected Key, group, quota, model limits, and billing rules are used for each test request.'
      )}
      contentClassName='sm:max-w-[560px]'
      contentHeight='auto'
      bodyClassName='space-y-5'
      footer={
        tab === 'platform' ? (
          <Button
            type='button'
            disabled={!selectedKey || !selectedModel}
            onClick={handlePlatformConnection}
          >
            {t('Use this model')}
          </Button>
        ) : (
          <Button type='submit' form={CUSTOM_CONNECTION_FORM_ID}>
            {t('Save connection')}
          </Button>
        )
      }
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as 'platform' | 'custom')}
      >
        <TabsList variant='line'>
          <TabsTrigger value='platform'>{t('My platform Key')}</TabsTrigger>
          <TabsTrigger value='custom'>{t('Custom endpoint')}</TabsTrigger>
        </TabsList>
        <TabsContent value='platform'>{platformContent}</TabsContent>
        <TabsContent value='custom'>
          <Form {...customForm}>
            <form
              id={CUSTOM_CONNECTION_FORM_ID}
              onSubmit={customForm.handleSubmit(handleCustomConnection)}
              className='space-y-4'
            >
              <FormField
                control={customForm.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Connection name')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={customForm.control}
                name='baseUrl'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('API address')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='url'
                        placeholder='https://api.example.com/v1'
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Use a public HTTPS OpenAI-compatible API address.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={customForm.control}
                name='model'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Model ID')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder='gpt-4.1' />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={customForm.control}
                name='apiKey'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('API Key')}</FormLabel>
                    <FormControl>
                      <Input {...field} type='password' autoComplete='off' />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The key stays in memory for this page and is cleared when you leave or refresh.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </TabsContent>
      </Tabs>
    </Dialog>
  )
}
