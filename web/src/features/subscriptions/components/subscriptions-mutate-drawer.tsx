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
import {
  CalendarClock,
  CreditCard,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
  sideDrawerSwitchItemClassName,
} from '@/components/drawer-layout'
import { MultiSelect } from '@/components/multi-select'
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
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { getPaymentErrorTranslation } from '@/features/wallet/lib/payment'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createPlan,
  updatePlan,
  getGroups,
  createWaffoPancakeSubscriptionProduct,
  listWaffoPancakeSubscriptionProductOptions,
} from '../api'
import { getDurationUnitOptions, getResetPeriodOptions } from '../constants'
import {
  formatWindowDuration,
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
  planToFormValues,
  formValuesToPlanPayload,
  type PlanFormValues,
} from '../lib'
import type { PlanRecord } from '../types'
import { useSubscriptions } from './subscriptions-provider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: PlanRecord
}

export function SubscriptionsMutateDrawer({
  open,
  onOpenChange,
  currentRow,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!currentRow?.plan?.id
  const { triggerRefresh } = useSubscriptions()
  const { meta: currencyMeta } = getCurrencyDisplay()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const currencyLabel = getCurrencyLabel()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [groupOptions, setGroupOptions] = useState<string[]>([])
  const [creatingPancakeProduct, setCreatingPancakeProduct] = useState(false)
  const [pancakeProducts, setPancakeProducts] = useState<
    { id: string; name: string; status: string }[]
  >([])

  const schema = getPlanFormSchema(t)
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PlanFormValues>,
    defaultValues: PLAN_FORM_DEFAULTS,
  })

  useEffect(() => {
    if (open) {
      if (currentRow?.plan) {
        form.reset(planToFormValues(currentRow.plan))
      } else {
        form.reset(PLAN_FORM_DEFAULTS)
      }
      getGroups()
        .then((res) => {
          if (res.success) {
            setGroupOptions(res.data || [])
          } else {
            handleServerError(res)
          }
        })
        .catch(() => {})
      // Best-effort — empty list still lets the operator use "+ Create".
      listWaffoPancakeSubscriptionProductOptions()
        .then((res) => {
          if (
            res.message === 'success' &&
            typeof res.data === 'object' &&
            res.data &&
            Array.isArray((res.data as { products?: unknown }).products)
          ) {
            setPancakeProducts(
              (res.data as { products: typeof pancakeProducts }).products
            )
          } else {
            setPancakeProducts([])
          }
        })
        .catch(() => setPancakeProducts([]))
    }
  }, [open, currentRow, form])

  const durationUnit = form.watch('duration_unit')
  const resetPeriod = form.watch('quota_reset_period')
  const planCurrency = form.watch('currency')
  const quotaWindows = form.watch('quota_windows')
  const hasQuotaWindows = quotaWindows.length > 0
  // Gate "+ Create on Pancake" on the same checks the mint handler runs.
  const watchedTitle = form.watch('title')
  const watchedPrice = form.watch('price_amount')
  const pancakeCreateReady =
    typeof watchedTitle === 'string' &&
    watchedTitle.trim().length > 0 &&
    Number(watchedPrice ?? 0) > 0

  const addQuotaWindow = (windowSeconds: number) => {
    const current = form.getValues('quota_windows')
    if (current.some((window) => window.window_seconds === windowSeconds)) {
      toast.error(t('Window durations must be unique'))
      return
    }
    form.setValue(
      'quota_windows',
      [
        ...current,
        {
          _key: crypto.randomUUID(),
          window_seconds: windowSeconds,
          quota_amount: 1,
        },
      ],
      { shouldDirty: true, shouldValidate: true }
    )
  }

  const removeQuotaWindow = (index: number) => {
    const current = form.getValues('quota_windows')
    form.setValue(
      'quota_windows',
      current.filter((_, itemIndex) => itemIndex !== index),
      { shouldDirty: true, shouldValidate: true }
    )
  }

  const onSubmit = async (values: PlanFormValues) => {
    setIsSubmitting(true)
    try {
      const payload = formValuesToPlanPayload(values)
      if (isEdit && currentRow?.plan?.id) {
        const res = await updatePlan(currentRow.plan.id, payload)
        if (res.success) {
          toast.success(t('Update succeeded'))
          onOpenChange(false)
          triggerRefresh()
        } else {
          handleServerError(res)
        }
      } else {
        const res = await createPlan(payload)
        if (res.success) {
          toast.success(t('Create succeeded'))
          onOpenChange(false)
          triggerRefresh()
        } else {
          handleServerError(res)
        }
      }
    } catch (error) {
      handleServerError(error, t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Mints a Pancake OnetimeProduct (not SubscriptionProduct — see
  // controller) using persisted creds + the form's title/price, then
  // pins the returned PROD_ ID into the form field.
  const handleCreatePancakeProduct = async () => {
    const title = form.getValues('title').trim()
    const priceAmount = Number(form.getValues('price_amount') || 0)
    if (!title) {
      toast.error(t('Plan title is required'))
      return
    }
    if (priceAmount <= 0) {
      toast.error(t('Plan price must be greater than zero'))
      return
    }
    setCreatingPancakeProduct(true)
    try {
      const res = await createWaffoPancakeSubscriptionProduct({
        name: title,
        amount: priceAmount.toFixed(2),
      })
      if (
        res.message === 'success' &&
        typeof res.data === 'object' &&
        res.data
      ) {
        const created = res.data as { product_id: string; product_name: string }
        form.setValue('waffo_pancake_product_id', created.product_id, {
          shouldDirty: true,
        })
        // Refetch from GraphQL so the dropdown reflects authoritative state.
        try {
          const refresh = await listWaffoPancakeSubscriptionProductOptions()
          if (
            refresh.message === 'success' &&
            typeof refresh.data === 'object' &&
            refresh.data &&
            Array.isArray((refresh.data as { products?: unknown }).products)
          ) {
            setPancakeProducts(
              (refresh.data as { products: typeof pancakeProducts }).products
            )
          }
        } catch {
          // Best-effort — form value already points at the new product;
          // raw-ID fallback covers the missing label.
        }
        toast.success(
          `${t('Waffo Pancake product created')}: ${created.product_id}`
        )
      } else {
        const reason =
          getPaymentErrorTranslation(res) ??
          (typeof res.data === 'string' ? res.data : undefined)
        handleServerError(res.data, undefined, {
          title: reason
            ? `${t('Waffo Pancake product creation failed')}: ${reason}`
            : t('Waffo Pancake product creation failed'),
        })
      }
    } catch (err) {
      handleServerError(
        err,
        `${t('Waffo Pancake product creation failed')}: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setCreatingPancakeProduct(false)
    }
  }

  const durationUnitOpts = getDurationUnitOptions(t)
  const resetPeriodOpts = getResetPeriodOptions(t)

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          form.reset()
        }
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[900px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isEdit ? t('Update plan info') : t('Create new subscription plan')}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? t('Modify existing subscription plan configuration')
              : t(
                  'Fill in the following info to create a new subscription plan'
                )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='subscription-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className={sideDrawerFormClassName(
              'grid content-start gap-4 sm:grid-cols-2 sm:gap-5'
            )}
          >
            {/* Basic Info */}
            <SideDrawerSection className='bg-card rounded-xl border p-4 shadow-sm sm:col-span-2 sm:p-5'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='info' size='xs'>
                  <Settings2 />
                </IconBadge>
                {t('Basic Info')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='title'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Plan Title')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('e.g. Basic Plan')} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='subtitle'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Plan Subtitle')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('e.g. Suitable for light usage')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='price_amount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Plan Price')}</FormLabel>
                      <div className='flex items-center gap-2'>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            step='0.01'
                            min={0}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseFloat(e.target.value) || 0
                              )
                            }
                          />
                        </FormControl>
                        <Select
                          items={[
                            { value: 'CNY', label: 'CNY' },
                            { value: 'USD', label: 'USD' },
                            { value: 'EUR', label: 'EUR' },
                          ]}
                          onValueChange={(value) =>
                            form.setValue('currency', value ?? '', {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                          value={planCurrency}
                        >
                          <SelectTrigger
                            className='w-28 shrink-0'
                            aria-label={t('Currency')}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              <SelectItem value='CNY'>CNY</SelectItem>
                              <SelectItem value='USD'>USD</SelectItem>
                              <SelectItem value='EUR'>EUR</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <FormDescription>
                        {t(
                          'Amount charged in the selected plan currency. Online payment support depends on the payment gateway.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='total_amount'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Quota ({{currency}})', { currency: currencyLabel })}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          disabled={hasQuotaWindows}
                          step={tokensOnly ? 1 : 0.01}
                          placeholder={
                            tokensOnly
                              ? t('Enter quota in tokens')
                              : t('Enter quota in {{currency}}', {
                                  currency: currencyLabel,
                                })
                          }
                          onChange={(e) =>
                            field.onChange(
                              Number.parseFloat(e.target.value) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {hasQuotaWindows
                          ? t(
                              'Legacy total quota is ignored while rolling windows are configured.'
                            )
                          : t(
                              'Total quota included in the plan, usable per billing period. 0 means unlimited.'
                            )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <p className='text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-xs leading-5'>
                {t(
                  "Plan price and usage quota are separate. Price is charged in the selected payment currency. Quota is the internal usage limit and follows the site's display currency; changing a custom currency symbol or display rate does not change the amount charged."
                )}{' '}
                {t(
                  'Subscription requests consume plan quota at the standard route rate, even when the account multiplier is zero. Wallet balance is not charged.'
                )}
              </p>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='upgrade_group'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Upgrade Group')}</FormLabel>
                      <FormControl>
                        <Combobox
                          options={[
                            { value: '__none__', label: t('No Upgrade') },
                            ...groupOptions.map((g) => ({
                              value: g,
                              label: g,
                            })),
                          ]}
                          onValueChange={(v) =>
                            field.onChange(v === '__none__' ? '' : v)
                          }
                          value={field.value || ''}
                          className='w-full'
                          placeholder={t('No Upgrade')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='downgrade_group'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Downgrade Group')}</FormLabel>
                      <FormControl>
                        <Combobox
                          options={[
                            {
                              value: '__none__',
                              label: t('Downgrade to pre-purchase group'),
                            },
                            ...groupOptions.map((g) => ({
                              value: g,
                              label: g,
                            })),
                          ]}
                          onValueChange={(v) =>
                            field.onChange(v === '__none__' ? '' : v)
                          }
                          value={field.value || ''}
                          className='w-full'
                          placeholder={t('Downgrade to pre-purchase group')}
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Downgrade to this group after the subscription expires'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name='route_groups'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Allowed Route Groups')}</FormLabel>
                    <FormControl>
                      <MultiSelect
                        options={groupOptions
                          .filter((group) => group !== 'auto')
                          .map((group) => ({
                            value: group,
                            label: group,
                          }))}
                        selected={field.value || []}
                        onChange={(groups) => field.onChange(groups)}
                        placeholder={t(
                          'Select groups whose channels can consume this subscription'
                        )}
                        emptyText={t('No matching route groups')}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'These groups provide the actual channels. The qualification group controls the account and multiplier; it does not need to contain channels.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='max_purchase_per_user'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Purchase Limit')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t('0 means unlimited')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='max_concurrency'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Account Concurrency')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Maximum concurrent requests across all API keys for this account. 0 means no plan-level limit.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='max_output_tokens'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t('Max Output Tokens per Request')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={1}
                          max={1_073_741_823}
                          step={1}
                          onChange={(e) =>
                            field.onChange(Number(e.target.value))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Used when the client omits an output limit. Higher client limits are rejected. The output budget is reserved before contacting the provider.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='sort_order'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Sort Order')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <p className='text-muted-foreground text-xs leading-5'>
                {t(
                  'Subscriptions currently support OpenAI, Claude, Responses and Gemini text generation APIs. Other endpoints are unavailable with subscription funding.'
                )}
              </p>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
                <FormField
                  control={form.control}
                  name='enabled'
                  render={({ field }) => (
                    <FormItem
                      className={sideDrawerSwitchItemClassName(
                        'min-h-0 flex-row items-center justify-start gap-2 rounded-lg border px-3 py-3'
                      )}
                    >
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className='!mt-0'>
                        {t('Enabled Status')}
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='allow_balance_pay'
                  render={({ field }) => (
                    <FormItem
                      className={sideDrawerSwitchItemClassName(
                        'min-h-0 flex-row items-center justify-start gap-2 rounded-lg border px-3 py-3'
                      )}
                    >
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className='!mt-0'>
                        {t('Allow balance redemption')}
                      </FormLabel>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='allow_wallet_overflow'
                  render={({ field }) => (
                    <FormItem
                      className={sideDrawerSwitchItemClassName(
                        'min-h-0 flex-row items-center justify-start gap-2 rounded-lg border px-3 py-3'
                      )}
                    >
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={hasQuotaWindows}
                        />
                      </FormControl>
                      <FormLabel className='!mt-0'>
                        {t('Allow wallet balance after quota used up')}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            </SideDrawerSection>

            {/* Duration Settings */}
            <SideDrawerSection className='bg-card rounded-xl border p-4 shadow-sm sm:p-5'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='chart-4' size='xs'>
                  <CalendarClock />
                </IconBadge>
                {t('Duration Settings')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='duration_unit'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Duration Unit')}</FormLabel>
                      <Select
                        items={durationUnitOpts.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {durationUnitOpts.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {durationUnit === 'custom' ? (
                  <FormField
                    control={form.control}
                    name='custom_seconds'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Custom Seconds')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={1}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseInt(e.target.value, 10) || 0
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name='duration_value'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Duration Value')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={1}
                            onChange={(e) =>
                              field.onChange(
                                Number.parseInt(e.target.value, 10) || 0
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </SideDrawerSection>

            {/* Quota Reset */}
            <SideDrawerSection className='bg-card rounded-xl border p-4 shadow-sm sm:p-5'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='success' size='xs'>
                  <RefreshCw />
                </IconBadge>
                {t('Quota Reset')}
              </h3>

              {hasQuotaWindows ? (
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Reset cycle settings apply only to legacy single-pool plans and are ignored for rolling windows.'
                  )}
                </p>
              ) : null}

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='quota_reset_period'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Reset Cycle')}</FormLabel>
                      <Select
                        items={resetPeriodOpts.map((o) => ({
                          value: o.value,
                          label: o.label,
                        }))}
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={hasQuotaWindows}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {resetPeriodOpts.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='quota_reset_custom_seconds'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Custom Seconds')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min={0}
                          disabled={resetPeriod !== 'custom'}
                          onChange={(e) =>
                            field.onChange(
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SideDrawerSection>

            <SideDrawerSection className='bg-card rounded-xl border p-4 shadow-sm sm:col-span-2 sm:p-5'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div>
                  <h3 className='flex items-center gap-2 text-sm font-medium'>
                    <IconBadge tone='info' size='xs'>
                      <RefreshCw />
                    </IconBadge>
                    {t('Rolling Quota Windows')}
                  </h3>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t(
                      'Each request cost counts toward every configured window. Any exhausted window blocks further requests without falling back to wallet balance.'
                    )}
                  </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  {[
                    { seconds: 5 * 60 * 60, label: t('5 Hours') },
                    { seconds: 7 * 24 * 60 * 60, label: t('7 Days') },
                    { seconds: 30 * 24 * 60 * 60, label: t('30 Days') },
                  ].map((preset) => (
                    <Button
                      key={preset.seconds}
                      type='button'
                      variant='outline'
                      size='sm'
                      onClick={() => addQuotaWindow(preset.seconds)}
                    >
                      <Plus className='mr-1 h-3.5 w-3.5' />
                      {preset.label}
                    </Button>
                  ))}
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => addQuotaWindow(24 * 60 * 60)}
                  >
                    <Plus className='mr-1 h-3.5 w-3.5' />
                    {t('Custom Window')}
                  </Button>
                </div>
              </div>

              {quotaWindows.length > 0 ? (
                <div className='grid grid-cols-1 gap-3 xl:grid-cols-2'>
                  {quotaWindows.map((window, index) => (
                    <div
                      key={window._key || window.window_seconds}
                      className='bg-muted/25 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-lg border p-3'
                    >
                      <FormField
                        control={form.control}
                        name={`quota_windows.${index}.window_seconds`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {t('Window ({{duration}})', {
                                duration: formatWindowDuration(
                                  window.window_seconds,
                                  t
                                ),
                              })}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type='number'
                                min={1}
                                onChange={(e) =>
                                  field.onChange(
                                    Number.parseInt(e.target.value, 10) || 0
                                  )
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`quota_windows.${index}.quota_amount`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {t('Window Quota ({{currency}})', {
                                currency: currencyLabel,
                              })}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type='number'
                                min={0}
                                step={tokensOnly ? 1 : 0.01}
                                onChange={(e) =>
                                  field.onChange(
                                    Number.parseFloat(e.target.value) || 0
                                  )
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        aria-label={t('Remove window')}
                        onClick={() => removeQuotaWindow(index)}
                      >
                        <X className='h-4 w-4' />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </SideDrawerSection>

            {/* Payment Config */}
            <SideDrawerSection className='bg-card rounded-xl border p-4 shadow-sm sm:col-span-2 sm:p-5'>
              <h3 className='flex items-center gap-2 text-sm font-medium'>
                <IconBadge tone='warning' size='xs'>
                  <CreditCard />
                </IconBadge>
                {t('Third-party Payment Config')}
              </h3>

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='stripe_price_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stripe Price ID</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder='price_...' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='creem_product_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Creem Product ID</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder='prod_...' />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name='waffo_pancake_product_id'
                render={({ field }) => {
                  // Raw-ID fallback for IDs not yet in the catalog.
                  const items = pancakeProducts.map((p) => ({
                    value: p.id,
                    label: `${p.name} (${p.id})`,
                  }))
                  if (
                    field.value &&
                    !pancakeProducts.some((p) => p.id === field.value)
                  ) {
                    items.push({ value: field.value, label: field.value })
                  }
                  return (
                    <FormItem>
                      <FormLabel>Waffo Pancake Product ID</FormLabel>
                      <div className='flex gap-2'>
                        <Combobox
                          options={items}
                          value={field.value || ''}
                          onValueChange={(v) => field.onChange(v)}
                          disabled={items.length === 0}
                          className='w-full flex-1'
                          placeholder={t('Select a product')}
                        />
                        <Button
                          type='button'
                          variant='outline'
                          onClick={handleCreatePancakeProduct}
                          disabled={
                            creatingPancakeProduct || !pancakeCreateReady
                          }
                          className='shrink-0'
                        >
                          {creatingPancakeProduct
                            ? t('Creating...')
                            : `+ ${t('Create')}`}
                        </Button>
                      </div>
                      <FormDescription>
                        {t(
                          'Creates a Pancake product in the saved store using this plan’s title and price. Requires Waffo Pancake to be fully configured in Payment settings first.'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
            </SideDrawerSection>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button
            form='subscription-form'
            type='submit'
            disabled={isSubmitting}
          >
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
