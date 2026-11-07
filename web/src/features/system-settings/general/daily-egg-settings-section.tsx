import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

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
  formatCurrencyFromUSD,
  getCurrencyDisplay,
  getCurrencyLabel,
} from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { DraftNumberInput } from '../models/draft-number-input'

const invalid = 'Invalid daily egg settings'
const prizeSchema = z.object({
  prizeId: z.string().min(1).max(36),
  name: z.string().trim().min(1, invalid).max(100, invalid),
  quota: z.number().int(invalid).min(1, invalid).max(1_000_000_000, invalid),
  quantity: z.number().int(invalid).min(1, invalid).max(1_000_000, invalid),
  probability: z
    .number()
    .min(0.01, invalid)
    .max(100, invalid)
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
      invalid
    ),
})
const schema = z
  .object({
    enabled: z.boolean(),
    minSpendCNY: z
      .number()
      .min(0, invalid)
      .max(1_000_000, invalid)
      .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
        invalid
      ),
    eggCount: z.number().int(invalid).min(2, invalid).max(12, invalid),
    prizes: z.array(prizeSchema).max(20, invalid),
  })
  .refine((value) => !value.enabled || value.prizes.length > 0, {
    path: ['prizes'],
    message: 'Add at least one prize',
  })
  .refine(
    (value) =>
      value.prizes.reduce(
        (sum, prize) => sum + Math.round(prize.probability * 100),
        0
      ) <= 10000,
    {
      path: ['prizes'],
      message: 'Prize probabilities cannot exceed 100%',
    }
  )
type Values = z.infer<typeof schema>

export function DailyEggSettingsSection(props: { setting: string }) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const currency = useSystemConfigStore((state) => state.config.currency)
  const { config, meta } = getCurrencyDisplay()
  const displayRate =
    meta.kind === 'tokens' ? config.quotaPerUnit : meta.exchangeRate
  const currencyLabel =
    currency.quotaDisplayType === 'TOKENS' ? t('Tokens') : getCurrencyLabel()
  const defaults = useMemo<Values>(() => {
    try {
      const value = JSON.parse(props.setting)
      const parsed = schema.safeParse({
        enabled: value.enabled,
        minSpendCNY: value.min_spend_cny,
        eggCount: value.egg_count,
        prizes: value.prizes?.map(
          (prize: {
            id: string
            name: string
            quota: number
            quantity: number
            probability: number
          }) => ({
            prizeId: prize.id,
            name: prize.name,
            quota: prize.quota,
            quantity: prize.quantity,
            probability: prize.probability / 100,
          })
        ),
      })
      if (parsed.success) return parsed.data
    } catch {}
    return { enabled: false, minSpendCNY: 2.5, eggCount: 3, prizes: [] }
  }, [props.setting])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  const prizes = useFieldArray({ control: form.control, name: 'prizes' })
  useEffect(() => {
    form.reset(defaults)
  }, [defaults, form])

  async function save(values: Values) {
    await updateOption.mutateAsync({
      key: 'DailyEggSetting',
      value: JSON.stringify({
        enabled: values.enabled,
        min_spend_cny: values.minSpendCNY,
        egg_count: values.eggCount,
        prizes: values.prizes.map((prize) => ({
          id: prize.prizeId,
          name: prize.name.trim(),
          quota: prize.quota,
          quantity: prize.quantity,
          probability: Math.round(prize.probability * 100),
        })),
      }),
    })
  }

  return (
    <SettingsSection title={t('Daily egg settings')}>
      <Form {...form}>
        <SettingsForm className='max-w-5xl' onSubmit={form.handleSubmit(save)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(save)}
            isSaving={updateOption.isPending}
            saveLabel='Save daily egg settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable daily egg')}</FormLabel>
                  <FormDescription>
                    {t('Each user can open one egg per day.')}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <SettingsFormGrid className='items-start'>
            <FormField
              control={form.control}
              name='minSpendCNY'
              render={({ field }) => {
                const displayValue = Number(
                  (
                    (field.value / config.usdExchangeRate) *
                    displayRate
                  ).toPrecision(8)
                )
                return (
                  <FormItem>
                    <FormLabel>
                      {t('Daily minimum spend')} ({currencyLabel})
                    </FormLabel>
                    <FormControl>
                      <DraftNumberInput
                        key={`${currency.quotaDisplayType}-${config.usdExchangeRate}-${displayRate}`}
                        min={0}
                        step='any'
                        {...field}
                        value={displayValue}
                        onValueChange={(amount) => {
                          if (amount === displayValue) return
                          field.onChange(
                            Math.round(
                              (amount / displayRate) *
                                config.usdExchangeRate *
                                100
                            ) / 100
                          )
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Counts settled API spending after refunds, converted using the system exchange rate.'
                      )}{' '}
                      {t('Effective minimum: {{amount}}', {
                        amount: formatCurrencyFromUSD(
                          field.value / config.usdExchangeRate,
                          { digitsLarge: 6, digitsSmall: 8, abbreviate: false }
                        ),
                      })}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )
              }}
            />
            <FormField
              control={form.control}
              name='eggCount'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Number of eggs')}</FormLabel>
                  <FormControl>
                    <DraftNumberInput
                      min={2}
                      max={12}
                      step={1}
                      {...field}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGrid>
          <div className='space-y-3'>
            <h3 className='font-medium'>{t('Prize pool')}</h3>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Quantities reset daily. Remaining probability and exhausted prizes result in no prize.'
              )}
            </p>
            {prizes.fields.map((prize, index) => (
              <div key={prize.id} className='space-y-4 rounded-lg border p-4'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-muted-foreground text-sm font-medium'>
                    #{index + 1}
                  </span>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    aria-label={t('Remove prize')}
                    onClick={() => prizes.remove(index)}
                  >
                    <Trash2 className='size-4' />
                  </Button>
                </div>
                <div className='grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4'>
                  <FormField
                    control={form.control}
                    name={`prizes.${index}.name`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Prize name')}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`prizes.${index}.quota`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('Reward quota')} ({currencyLabel})
                        </FormLabel>
                        <FormControl>
                          <DraftNumberInput
                            key={`${currency.quotaDisplayType}-${config.quotaPerUnit}-${displayRate}`}
                            min={0}
                            step='any'
                            {...field}
                            value={Number(
                              quotaUnitsToDollars(field.value).toPrecision(12)
                            )}
                            onValueChange={(amount) =>
                              field.onChange(parseQuotaFromDollars(amount))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`prizes.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Daily quantity')}</FormLabel>
                        <FormControl>
                          <DraftNumberInput
                            min={1}
                            step={1}
                            {...field}
                            onValueChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`prizes.${index}.probability`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Probability (%)')}</FormLabel>
                        <FormControl>
                          <DraftNumberInput
                            min={0.01}
                            max={100}
                            step={0.01}
                            {...field}
                            onValueChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ))}
            {(form.formState.errors.prizes?.root?.message ||
              form.formState.errors.prizes?.message) && (
              <p className='text-destructive text-sm'>
                {t(
                  form.formState.errors.prizes?.root?.message ||
                    form.formState.errors.prizes?.message ||
                    invalid
                )}
              </p>
            )}
            <Button
              type='button'
              variant='outline'
              disabled={prizes.fields.length >= 20}
              onClick={() =>
                prizes.append({
                  prizeId:
                    globalThis.crypto?.randomUUID?.() ??
                    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
                  name: '',
                  quota: 1000,
                  quantity: 1,
                  probability: 1,
                })
              }
            >
              <Plus className='size-4' /> {t('Add prize')}
            </Button>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
