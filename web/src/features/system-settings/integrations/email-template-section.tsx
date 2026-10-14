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
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { previewEmailTemplate } from '../api'
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

type EmailTemplateDefault = {
  key: string
  subject: string
  body: string
  variables: string[]
}

type EmailTemplateDraft = {
  subject: string
  body: string
}

type EmailLayoutDraft = {
  brand?: string
  footer?: string
}

const LAYOUT_TAB = 'layout'
const PREVIEW_DEBOUNCE_MS = 300

const TEMPLATE_NAME_KEYS: Record<string, string> = {
  verify: 'Verification code',
  reset: 'Password reset',
  binding: 'Email change confirmation',
  quota: 'Balance reminder',
  security: 'Account security alert',
  ticket: 'Ticket notification',
}

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function initialDrafts(
  templates: string,
  defaults: EmailTemplateDefault[]
): Record<string, EmailTemplateDraft> {
  const stored = parseJSON<Record<string, Partial<EmailTemplateDraft>>>(
    templates,
    {}
  )
  const drafts: Record<string, EmailTemplateDraft> = {}
  for (const template of defaults) {
    const override = stored[template.key]
    drafts[template.key] = {
      subject: override?.subject || template.subject,
      body: override?.body || template.body,
    }
  }
  return drafts
}

export function EmailTemplateSection(props: {
  templates: string
  defaults: string
  layout: string
}) {
  const defaults = parseJSON<EmailTemplateDefault[]>(props.defaults, [])
  if (defaults.length === 0) return null
  return (
    <EmailTemplateForm
      key={`${props.templates}:${props.layout}`}
      templates={props.templates}
      defaults={defaults}
      layout={props.layout}
    />
  )
}

function EmailTemplateForm(props: {
  templates: string
  defaults: EmailTemplateDefault[]
  layout: string
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [drafts, setDrafts] = useState<Record<string, EmailTemplateDraft>>(() =>
    initialDrafts(props.templates, props.defaults)
  )
  const [layout, setLayout] = useState<EmailLayoutDraft>(() =>
    parseJSON<EmailLayoutDraft>(props.layout, {})
  )
  const [activeTab, setActiveTab] = useState(LAYOUT_TAB)
  const [preview, setPreview] = useState<{
    name: string
    subject: string
    html: string
  } | null>(null)
  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const lastField = useRef<'subject' | 'body'>('body')
  // The global tab previews a representative template so brand and footer
  // changes stay visible while editing them.
  const previewKey =
    activeTab === LAYOUT_TAB ? (props.defaults[0]?.key ?? null) : activeTab
  const previewMutation = useMutation({
    mutationFn: async (key: string) => {
      const template = props.defaults.find((item) => item.key === key)
      if (!template) throw new Error('Unknown email template')
      return requireServerSuccess(
        await previewEmailTemplate({
          key: template.key,
          subject: drafts[key]?.subject ?? '',
          body: drafts[key]?.body ?? '',
          brand: layout.brand ?? '',
          footer: layout.footer ?? '',
        })
      ).data
    },
    onSuccess: (result, key) => {
      setPreview({
        name: t(TEMPLATE_NAME_KEYS[key] ?? key),
        subject: result.subject,
        html: result.html,
      })
    },
    onError: (error) => handleServerError(error, t('Failed to update setting')),
  })
  const runPreview = previewMutation.mutate
  useEffect(() => {
    if (!previewKey) return
    const timer = setTimeout(() => runPreview(previewKey), PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [previewKey, drafts, layout, runPreview])
  const insertVariable = (key: string, name: string) => {
    const field = lastField.current
    const element = field === 'subject' ? subjectRef.current : bodyRef.current
    const draft = drafts[key] ?? { subject: '', body: '' }
    const value = field === 'subject' ? draft.subject : draft.body
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    const token = `{{.${name}}}`
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...draft,
        [field]: value.slice(0, start) + token + value.slice(end),
      },
    }))
    const caret = start + token.length
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(caret, caret)
    })
  }
  const save = async () => {
    await updateOption.mutateAsync({
      key: 'EmailLayout',
      value: JSON.stringify({
        brand: layout.brand ?? '',
        footer: layout.footer ?? '',
      }),
    })
    // Only store templates the administrator actually changed. Untouched
    // templates keep the built-in, per-language content.
    const overrides: Record<string, EmailTemplateDraft> = {}
    for (const template of props.defaults) {
      const draft = drafts[template.key]
      if (!draft) continue
      if (
        draft.subject === template.subject &&
        draft.body === template.body
      ) {
        continue
      }
      overrides[template.key] = draft
    }
    await updateOption.mutateAsync({
      key: 'EmailTemplates',
      value: JSON.stringify(overrides),
    })
  }
  return (
    <SettingsSection title={t('Email Templates')}>
      <SettingsForm
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <SettingsPageFormActions
          onSave={() => void save()}
          isSaving={updateOption.isPending}
          saveLabel='Save email templates'
        />
        <p className='text-muted-foreground text-sm'>
          {t(
            'Customize the emails sent for verification, password reset, email changes, security alerts and ticket notifications.'
          )}
        </p>
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(String(value))}
        >
          <TabsList className='h-auto w-fit max-w-full flex-wrap justify-start'>
            <TabsTrigger value={LAYOUT_TAB}>{t('Global settings')}</TabsTrigger>
            {props.defaults.map((template) => (
              <TabsTrigger key={template.key} value={template.key}>
                {t(TEMPLATE_NAME_KEYS[template.key] ?? template.key)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className='grid min-w-0 items-start gap-4 lg:grid-cols-2'>
            <Card className='min-w-0'>
              <CardContent className='flex min-w-0 flex-col gap-4'>
                <TabsContent value={LAYOUT_TAB} className='flex flex-col gap-3'>
                  <div className='flex max-w-md flex-col gap-2'>
                    <Label htmlFor='email-layout-brand'>
                      {t('Brand name')}
                    </Label>
                    <Input
                      id='email-layout-brand'
                      value={layout.brand ?? ''}
                      placeholder='{{.SystemName}}'
                      disabled={updateOption.isPending}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          brand: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className='flex max-w-md flex-col gap-2'>
                    <Label htmlFor='email-layout-footer'>
                      {t('Footer text')}
                    </Label>
                    <Input
                      id='email-layout-footer'
                      value={layout.footer ?? ''}
                      placeholder='{{.SystemName}}'
                      disabled={updateOption.isPending}
                      onChange={(event) =>
                        setLayout((current) => ({
                          ...current,
                          footer: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Leave the brand or footer empty to use the system name. Both support {{.SystemName}}.'
                    )}
                  </p>
                </TabsContent>
                {props.defaults.map((template) => (
                  <TabsContent
                    key={template.key}
                    value={template.key}
                    className='flex flex-col gap-3'
                  >
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <span className='text-muted-foreground text-xs'>
                          {t('Variables')}:
                        </span>
                        {template.variables.map((name) => (
                          <Button
                            key={name}
                            type='button'
                            variant='secondary'
                            size='xs'
                            disabled={updateOption.isPending}
                            onClick={() => insertVariable(template.key, name)}
                          >
                            {`{{.${name}}}`}
                          </Button>
                        ))}
                      </div>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        disabled={updateOption.isPending}
                        onClick={() =>
                          setDrafts((current) => ({
                            ...current,
                            [template.key]: {
                              subject: template.subject,
                              body: template.body,
                            },
                          }))
                        }
                      >
                        {t('Restore default')}
                      </Button>
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      {t('Click a variable to insert it at the cursor.')}
                    </p>
                    <div className='flex max-w-xl flex-col gap-2'>
                      <Label htmlFor={`email-template-${template.key}-subject`}>
                        {t('Subject')}
                      </Label>
                      <Input
                        id={`email-template-${template.key}-subject`}
                        ref={subjectRef}
                        value={drafts[template.key]?.subject ?? ''}
                        disabled={updateOption.isPending}
                        onFocus={() => {
                          lastField.current = 'subject'
                        }}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [template.key]: {
                              ...current[template.key],
                              subject: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className='flex flex-col gap-2'>
                      <Label htmlFor={`email-template-${template.key}-body`}>
                        {t('Body')}
                      </Label>
                      <Textarea
                        id={`email-template-${template.key}-body`}
                        ref={bodyRef}
                        className='min-h-40 font-mono text-xs'
                        value={drafts[template.key]?.body ?? ''}
                        disabled={updateOption.isPending}
                        onFocus={() => {
                          lastField.current = 'body'
                        }}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [template.key]: {
                              ...current[template.key],
                              body: event.target.value,
                            },
                          }))
                        }
                      />
                      <p className='text-muted-foreground text-xs'>
                        {t('Use HTML and the variables listed above.')}
                      </p>
                    </div>
                  </TabsContent>
                ))}
              </CardContent>
            </Card>
            <Card className='min-w-0 lg:sticky lg:top-4'>
              <CardContent className='flex min-w-0 flex-col gap-3'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <p className='text-sm font-medium'>{t('Live preview')}</p>
                  <span className='text-muted-foreground text-xs'>
                    {previewMutation.isPending
                      ? t('Rendering...')
                      : t('Preview uses sample values for the variables.')}
                  </span>
                </div>
                <div className='bg-muted/30 rounded-lg border p-3'>
                  <div className='bg-background overflow-hidden rounded-md border'>
                    <div className='border-b px-3 py-2'>
                      <p className='text-muted-foreground text-xs'>
                        {preview?.name ?? t('Preview')}
                      </p>
                      <p className='truncate text-sm font-medium'>
                        {preview?.subject ?? ''}
                      </p>
                    </div>
                    <iframe
                      title={preview?.name ?? t('Preview')}
                      srcDoc={preview?.html ?? ''}
                      sandbox=''
                      className='h-[clamp(320px,45vh,560px)] w-full bg-white'
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </Tabs>
      </SettingsForm>
    </SettingsSection>
  )
}
