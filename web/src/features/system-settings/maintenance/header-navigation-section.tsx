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
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import {
  MAX_HEADER_NAV_LINKS,
  MAX_HEADER_NAV_LINK_NAME_LENGTH,
} from '@/lib/nav-modules'

import {
  SettingsControlChildren,
  SettingsForm,
  SettingsSwitchContent,
  SettingsControlGroup,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  HEADER_NAV_DEFAULT,
  type HeaderNavModulesConfig,
  serializeHeaderNavModules,
} from './config'

const headerNavSchema = z.object({
  links: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, 'Name is required')
          .max(
            MAX_HEADER_NAV_LINK_NAME_LENGTH,
            'Link name cannot exceed 20 characters'
          ),
        url: z
          .string()
          .trim()
          .min(1, 'URL is required')
          .refine(
            (value) => /^https?:\/\/\S+$/i.test(value.trim()),
            'URL must start with http:// or https://'
          ),
      })
    )
    .max(MAX_HEADER_NAV_LINKS, 'At most 10 links are supported'),
  home: z.boolean(),
  console: z.boolean(),
  pricingEnabled: z.boolean(),
  pricingRequireAuth: z.boolean(),
  rankingsEnabled: z.boolean(),
  rankingsRequireAuth: z.boolean(),
  docs: z.boolean(),
  about: z.boolean(),
  contact: z.boolean(),
  setupDownload: z.boolean(),
})

type HeaderNavFormValues = z.infer<typeof headerNavSchema>

/** Every form field except the custom link list renders as a switch. */
type HeaderNavSwitchKey = Exclude<keyof HeaderNavFormValues, 'links'>

type HeaderNavigationSectionProps = {
  config: HeaderNavModulesConfig
  initialSerialized: string
}

const toFormValues = (config: HeaderNavModulesConfig): HeaderNavFormValues => ({
  links: (config.links ?? []).map((link) => ({ ...link })),
  home:
    config.home === undefined ? HEADER_NAV_DEFAULT.home : Boolean(config.home),
  console:
    config.console === undefined
      ? HEADER_NAV_DEFAULT.console
      : Boolean(config.console),
  pricingEnabled:
    config.pricing?.enabled === undefined
      ? HEADER_NAV_DEFAULT.pricing.enabled
      : Boolean(config.pricing.enabled),
  pricingRequireAuth:
    config.pricing?.requireAuth === undefined
      ? HEADER_NAV_DEFAULT.pricing.requireAuth
      : Boolean(config.pricing.requireAuth),
  rankingsEnabled:
    config.rankings?.enabled === undefined
      ? HEADER_NAV_DEFAULT.rankings.enabled
      : Boolean(config.rankings.enabled),
  rankingsRequireAuth:
    config.rankings?.requireAuth === undefined
      ? HEADER_NAV_DEFAULT.rankings.requireAuth
      : Boolean(config.rankings.requireAuth),
  docs:
    config.docs === undefined ? HEADER_NAV_DEFAULT.docs : Boolean(config.docs),
  about:
    config.about === undefined
      ? HEADER_NAV_DEFAULT.about
      : Boolean(config.about),
  contact:
    config.contact === undefined
      ? HEADER_NAV_DEFAULT.contact
      : Boolean(config.contact),
  setupDownload:
    config.setupDownload === undefined
      ? HEADER_NAV_DEFAULT.setupDownload
      : Boolean(config.setupDownload),
})

export function HeaderNavigationSection({
  config,
  initialSerialized,
}: HeaderNavigationSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const formDefaults = useMemo(() => toFormValues(config), [config])

  const form = useForm<HeaderNavFormValues>({
    resolver: zodResolver(headerNavSchema),
    defaultValues: formDefaults,
  })

  const linkFields = useFieldArray({ control: form.control, name: 'links' })

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const onSubmit = async (values: HeaderNavFormValues) => {
    const payload: HeaderNavModulesConfig = {
      ...config,
      links: values.links.map((link) => ({
        name: link.name.trim(),
        url: link.url.trim(),
      })),
      home: values.home,
      console: values.console,
      docs: values.docs,
      about: values.about,
      contact: values.contact,
      setupDownload: values.setupDownload,
      pricing: {
        ...(config.pricing ?? HEADER_NAV_DEFAULT.pricing),
        enabled: values.pricingEnabled,
        requireAuth: values.pricingRequireAuth,
      },
      rankings: {
        ...(config.rankings ?? HEADER_NAV_DEFAULT.rankings),
        enabled: values.rankingsEnabled,
        requireAuth: values.rankingsRequireAuth,
      },
    }

    const serialized = serializeHeaderNavModules(payload)
    if (serialized === initialSerialized) {
      return
    }

    await updateOption.mutateAsync({
      key: 'HeaderNavModules',
      value: serialized,
    })
  }

  const resetToDefault = () => {
    form.reset(toFormValues(HEADER_NAV_DEFAULT))
  }

  const simpleModules: Array<{
    key: HeaderNavSwitchKey
    title: string
    description: string
  }> = [
    {
      key: 'home',
      title: t('Home'),
      description: t('Landing page with system overview.'),
    },
    {
      key: 'console',
      title: t('Console'),
      description: t('User dashboard and quota controls.'),
    },
    {
      key: 'docs',
      title: t('Docs'),
      description: t('Documentation or external knowledge base.'),
    },
    {
      key: 'about',
      title: t('About'),
      description: t('Static page describing the platform.'),
    },
    {
      key: 'contact',
      title: t('Contact Us'),
      description: t('Contact information and community group.'),
    },
    {
      key: 'setupDownload',
      title: t('Download Setup'),
      description: t(
        'Show KunCode Setup downloads in navigation, the home page, API keys, and the key creation dialog.'
      ),
    },
  ]

  const accessModules: Array<{
    enabledKey: HeaderNavSwitchKey
    requireAuthKey: HeaderNavSwitchKey
    requireAuthDependsOn: 'pricingEnabled' | 'rankingsEnabled'
    title: string
    description: string
    requireAuthTitle: string
    requireAuthDescription: string
  }> = [
    {
      enabledKey: 'pricingEnabled',
      requireAuthKey: 'pricingRequireAuth',
      requireAuthDependsOn: 'pricingEnabled',
      title: t('Model Square'),
      description: t('Public model catalog and pricing page.'),
      requireAuthTitle: t('Require login to view models'),
      requireAuthDescription: t(
        'Visitors must authenticate before accessing the pricing directory.'
      ),
    },
    {
      enabledKey: 'rankingsEnabled',
      requireAuthKey: 'rankingsRequireAuth',
      requireAuthDependsOn: 'rankingsEnabled',
      title: t('Rankings'),
      description: t('Public rankings page based on live usage data.'),
      requireAuthTitle: t('Require login to view rankings'),
      requireAuthDescription: t(
        'Visitors must authenticate before accessing the rankings page.'
      ),
    },
  ]

  return (
    <SettingsSection title={t('Header navigation')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            onReset={resetToDefault}
            isSaving={updateOption.isPending}
            resetLabel='Reset to default'
            saveLabel='Save navigation'
          />
          <div className='grid gap-4 md:grid-cols-2'>
            {simpleModules.map((module) => (
              <FormField
                key={module.key}
                control={form.control}
                name={module.key}
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{module.title}</FormLabel>
                      <FormDescription>{module.description}</FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </SettingsSwitchItem>
                )}
              />
            ))}
          </div>

          <div className='grid gap-4 lg:grid-cols-2'>
            {accessModules.map((module) => (
              <SettingsControlGroup key={module.enabledKey}>
                <FormField
                  control={form.control}
                  name={module.enabledKey}
                  render={({ field }) => (
                    <SettingsSwitchItem>
                      <SettingsSwitchContent>
                        <FormLabel>{module.title}</FormLabel>
                        <FormDescription>{module.description}</FormDescription>
                      </SettingsSwitchContent>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </SettingsSwitchItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={module.requireAuthKey}
                  render={({ field }) => (
                    <SettingsControlChildren>
                      <SettingsSwitchItem className='py-2'>
                        <SettingsSwitchContent>
                          <FormLabel>{module.requireAuthTitle}</FormLabel>
                          <FormDescription>
                            {module.requireAuthDescription}
                          </FormDescription>
                        </SettingsSwitchContent>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={!form.watch(module.requireAuthDependsOn)}
                          />
                        </FormControl>
                        <FormMessage />
                      </SettingsSwitchItem>
                    </SettingsControlChildren>
                  )}
                />
              </SettingsControlGroup>
            ))}
          </div>

          <div className='space-y-3'>
            <div className='space-y-1'>
              <p className='text-sm font-medium'>{t('Custom links')}</p>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Up to {{count}} links. Names display exactly as typed; URLs open in a new tab and are visible to every visitor.',
                  { count: MAX_HEADER_NAV_LINKS }
                )}
              </p>
            </div>

            {linkFields.fields.length === 0 && (
              <p className='text-muted-foreground rounded-lg border border-dashed px-3 py-6 text-center text-sm'>
                {t('No custom links yet.')}
              </p>
            )}

            {linkFields.fields.map((field, index) => (
              <div
                key={field.id}
                className='grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]'
              >
                <FormField
                  control={form.control}
                  name={`links.${index}.name`}
                  render={({ field: nameField }) => (
                    <FormItem>
                      <FormLabel>{t('Link name')}</FormLabel>
                      <FormControl>
                        <Input {...nameField} autoComplete='off' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`links.${index}.url`}
                  render={({ field: urlField }) => (
                    <FormItem>
                      <FormLabel>{t('URL')}</FormLabel>
                      <FormControl>
                        <Input
                          {...urlField}
                          placeholder='https://example.com'
                          autoComplete='off'
                          inputMode='url'
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className='flex items-end'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={t('Remove link')}
                    onClick={() => linkFields.remove(index)}
                  >
                    <Trash2 className='size-4' aria-hidden='true' />
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={linkFields.fields.length >= MAX_HEADER_NAV_LINKS}
              onClick={() => linkFields.append({ name: '', url: '' })}
            >
              <Plus className='size-4' aria-hidden='true' />
              {t('Add link')}
            </Button>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
