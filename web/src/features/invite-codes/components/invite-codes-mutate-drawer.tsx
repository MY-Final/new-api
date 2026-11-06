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
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
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
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { normalizeInviteCode } from '@/features/auth/lib/invite-code'
import { getGroups } from '@/features/users/api'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { getEditableQuotaStep } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { createInviteCode, updateInviteCode } from '../api'
import {
  getInviteCodeFormSchema,
  INVITE_CODE_FORM_DEFAULTS,
  inviteCodeToFormValues,
  formValuesToInviteCodePayload,
  type InviteCodeFormValues,
} from '../lib/invite-code-form'
import type { InviteCode } from '../types'

type InviteCodesMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: InviteCode | null
  onSaved: () => void
}

export function InviteCodesMutateDrawer(props: InviteCodesMutateDrawerProps) {
  const { t } = useTranslation()
  const isUpdate = Boolean(props.currentRow)
  const currencyConfig = useSystemConfigStore((state) => state.config.currency)
  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly =
    currencyConfig.quotaDisplayType === 'TOKENS' ||
    currencyMeta.kind === 'tokens'
  const form = useForm<InviteCodeFormValues>({
    resolver: zodResolver(getInviteCodeFormSchema(t)),
    defaultValues: INVITE_CODE_FORM_DEFAULTS,
  })

  const groupsQuery = useQuery({
    queryKey: ['invite-codes', 'groups'],
    queryFn: async () => {
      const response = requireServerSuccess(await getGroups())
      return response.data ?? []
    },
    enabled: props.open,
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  const groupOptions = groupsQuery.data ?? []
  const saveMutation = useMutation({
    mutationFn: async (values: InviteCodeFormValues) => {
      const payload = formValuesToInviteCodePayload(values)
      const response =
        isUpdate && props.currentRow
          ? await updateInviteCode(props.currentRow.id, payload)
          : await createInviteCode(payload)
      return requireServerSuccess(response)
    },
    onSuccess: () => {
      toast.success(
        t(isUpdate ? 'Invitation code updated' : 'Invitation code created')
      )
      props.onOpenChange(false)
      props.onSaved()
    },
    onError: (error) => handleServerError(error),
    meta: { errorToast: false },
  })

  useEffect(() => {
    if (!props.open) return
    form.reset(
      props.currentRow
        ? inviteCodeToFormValues(props.currentRow)
        : INVITE_CODE_FORM_DEFAULTS
    )
  }, [form, props.currentRow, props.open])

  useEffect(() => {
    if (!groupsQuery.isError) return
    form.setError('group', {
      message: t('Failed to load groups. Try again.'),
    })
  }, [form, groupsQuery.isError, t])

  const onSubmit = (values: InviteCodeFormValues) => {
    if (!groupOptions.includes(values.group)) {
      form.setError('group', { message: t('Choose an existing group') })
      return
    }
    saveMutation.mutate(values)
  }

  const bonusLabel = tokensOnly
    ? t('Registration bonus (tokens)')
    : t('Registration bonus ({{currency}})', { currency: currencyLabel })
  const bonusPlaceholder = tokensOnly
    ? t('Enter quota in tokens')
    : t('Enter quota in {{currency}}', { currency: currencyLabel })
  let submitLabel = t('Create invitation code')
  if (saveMutation.isPending) {
    submitLabel = t('Saving...')
  } else if (isUpdate) {
    submitLabel = t('Save changes')
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[720px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Edit Invitation Code') : t('Create Invitation Code')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'Each code can set its own registration capacity, group, bonus, and expiration.'
            )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='invite-code-form'
            className={sideDrawerFormClassName()}
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <fieldset disabled={saveMutation.isPending} className='contents'>
              <SideDrawerSection>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Campaign name')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t('For example, Magpie')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Name shown in the administrator console.')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='code'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Invitation code')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            disabled={isUpdate}
                            autoCapitalize='none'
                            autoCorrect='off'
                            spellCheck={false}
                            placeholder={t('Leave blank to generate')}
                            onChange={(event) =>
                              field.onChange(
                                normalizeInviteCode(event.target.value)
                              )
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {isUpdate
                            ? t('The invitation code cannot be changed.')
                            : t(
                                'Lowercase letters, numbers, hyphens, and underscores.'
                              )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='enabled'
                  render={({ field }) => (
                    <FormItem className='border-border/60 flex min-h-16 flex-row items-center justify-between gap-3 rounded-lg border px-3 py-3'>
                      <div className='space-y-1'>
                        <FormLabel>{t('Enable invitation code')}</FormLabel>
                        <FormDescription>
                          {t(
                            'Disabled codes stay in the list with their registration history.'
                          )}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </SideDrawerSection>

              <SideDrawerSection>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='group'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Registration group')}</FormLabel>
                        <FormControl>
                          <Combobox
                            className='w-full'
                            options={groupOptions.map((group) => ({
                              value: group,
                              label: group,
                            }))}
                            value={field.value}
                            onValueChange={(value) => {
                              if (value !== null) field.onChange(value)
                            }}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            disabled={groupsQuery.isLoading}
                            placeholder={
                              groupsQuery.isLoading
                                ? t('Loading groups...')
                                : t('Select a group')
                            }
                            emptyText={t('No group found.')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'New accounts are assigned to this existing group.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='inviter_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Inviter user ID')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step={1}
                            value={field.value}
                            onChange={(event) =>
                              field.onChange(
                                Number.parseInt(event.target.value, 10) || 0
                              )
                            }
                            onBlur={field.onBlur}
                            name={field.name}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Set to 0 when the campaign does not credit an inviter.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='registration_limit'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Registration limit')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            max={1_000_000_000}
                            step={1}
                            value={field.value}
                            onChange={(event) =>
                              field.onChange(
                                Number.parseInt(event.target.value, 10) || 0
                              )
                            }
                            onBlur={field.onBlur}
                            name={field.name}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Set to 0 for unlimited registrations.')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='bonus_amount'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{bonusLabel}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step={getEditableQuotaStep()}
                            value={field.value}
                            placeholder={bonusPlaceholder}
                            onChange={(event) =>
                              field.onChange(
                                Number.parseFloat(event.target.value) || 0
                              )
                            }
                            onBlur={field.onBlur}
                            name={field.name}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Added to every new account that registers with this code.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='expires_at'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Expiration time')}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('Never expires')}
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Leave empty for a code that never expires.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SideDrawerSection>

              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name='remark'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Remark')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={t('Internal note for this campaign')}
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SideDrawerSection>
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button type='button' variant='outline' />}>
            {t('Cancel')}
          </SheetClose>
          <Button
            type='submit'
            form='invite-code-form'
            disabled={
              saveMutation.isPending ||
              groupsQuery.isLoading ||
              groupOptions.length === 0
            }
          >
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
