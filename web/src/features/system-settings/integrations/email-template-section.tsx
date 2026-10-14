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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

const TEMPLATE_NAME_KEYS: Record<string, string> = {
  verify: 'Verification code',
  reset: 'Password reset',
  binding: 'Email change confirmation',
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
  const [layout, setLayout] = useState(() =>
    parseJSON<{ brand?: string; footer?: string }>(props.layout, {})
  )
  const [preview, setPreview] = useState<{
    name: string
    subject: string
    html: string
  } | null>(null)
  const previewMutation = useMutation({
    mutationFn: async (template: EmailTemplateDefault) =>
      requireServerSuccess(
        await previewEmailTemplate({
          key: template.key,
          subject: drafts[template.key]?.subject ?? '',
          body: drafts[template.key]?.body ?? '',
          brand: layout.brand ?? '',
          footer: layout.footer ?? '',
        })
      ).data,
    onSuccess: (result, template) => {
      setPreview({
        name: t(TEMPLATE_NAME_KEYS[template.key] ?? template.key),
        subject: result.subject,
        html: result.html,
      })
    },
    onError: (error) => handleServerError(error, t('Failed to update setting')),
  })
  const save = async () => {
    await updateOption.mutateAsync({
      key: 'EmailLayout',
      value: JSON.stringify({
        brand: layout.brand ?? '',
        footer: layout.footer ?? '',
      }),
    })
    await updateOption.mutateAsync({
      key: 'EmailTemplates',
      value: JSON.stringify(drafts),
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
        <div className='flex flex-col gap-3 rounded-lg border p-4'>
          <p className='font-medium'>{t('Email layout')}</p>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='email-layout-brand'>{t('Brand name')}</Label>
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
          <div className='flex flex-col gap-2'>
            <Label htmlFor='email-layout-footer'>{t('Footer text')}</Label>
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
        </div>
        {props.defaults.map((template) => (
          <div
            key={template.key}
            className='flex flex-col gap-3 rounded-lg border p-4'
          >
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='font-medium'>
                {t(TEMPLATE_NAME_KEYS[template.key] ?? template.key)}
              </p>
              <div className='flex flex-wrap items-center gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  disabled={previewMutation.isPending}
                  onClick={() => previewMutation.mutate(template)}
                >
                  {t('Preview')}
                </Button>
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
            </div>
            <p className='text-muted-foreground text-xs'>
              {t('Available variables')}:{' '}
              <code>
                {template.variables.map((name) => `{{.${name}}}`).join(' ')}
              </code>
            </p>
            <div className='flex flex-col gap-2'>
              <Label htmlFor={`email-template-${template.key}-subject`}>
                {t('Subject')}
              </Label>
              <Input
                id={`email-template-${template.key}-subject`}
                value={drafts[template.key]?.subject ?? ''}
                disabled={updateOption.isPending}
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
                className='min-h-40 font-mono text-xs'
                value={drafts[template.key]?.body ?? ''}
                disabled={updateOption.isPending}
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
          </div>
        ))}
      </SettingsForm>
      <Dialog
        open={preview !== null}
        title={preview?.name ?? t('Preview')}
        description={t('Preview uses sample values for the variables.')}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        contentClassName='sm:max-w-3xl'
      >
        {preview && (
          <div className='flex flex-col gap-3'>
            <div className='flex flex-col gap-1'>
              <p className='text-muted-foreground text-xs'>{t('Subject')}</p>
              <p className='text-sm font-medium [overflow-wrap:anywhere]'>
                {preview.subject}
              </p>
            </div>
            <iframe
              title={preview.name}
              srcDoc={preview.html}
              sandbox=''
              className='h-[60vh] w-full rounded-md border bg-white'
            />
          </div>
        )}
      </Dialog>
    </SettingsSection>
  )
}
