import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { getShowcaseGroups, getShowcaseModels, saveShowcasePlan } from '../api'
import { planSchema, type PlanValues } from '../lib/schema'
import type { ShowcasePlan } from '../types'

export function ShowcasePlanForm(props: {
  plan: ShowcasePlan | null
  onSaved: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const form = useForm<PlanValues>({
    resolver: zodResolver(planSchema),
    defaultValues: props.plan ?? {
      name: '',
      group: '',
      model: '',
      prompt: t(
        'Draw an SVG animation of a pelican riding a bicycle, with coordinated legs, pedals and wheels, grass, blue sky and clouds.'
      ),
      interval_minutes: 60,
      keep_count: 24,
      max_output_tokens: 9216,
      timeout_seconds: 1800,
      sort_order: 0,
      enabled: false,
      public: true,
    },
  })
  const group = form.watch('group')
  const groups = useQuery({
    queryKey: ['showcase-groups'],
    queryFn: getShowcaseGroups,
  })
  const models = useQuery({
    queryKey: ['showcase-models', group],
    queryFn: () => getShowcaseModels(group),
    enabled: Boolean(group),
  })
  const save = useMutation({
    mutationFn: (values: PlanValues) =>
      saveShowcasePlan({ ...values, id: props.plan?.id ?? 0 }),
    onSuccess: props.onSaved,
  })
  const numberFields = [
    {
      name: 'interval_minutes',
      label: t('Test interval (minutes)'),
      min: 1,
      max: 10080,
    },
    { name: 'keep_count', label: t('Keep recent results'), min: 1, max: 100 },
    {
      name: 'max_output_tokens',
      label: t('Maximum output tokens'),
      min: 128,
      max: 32768,
    },
    {
      name: 'timeout_seconds',
      label: t('Timeout (seconds)'),
      min: 30,
      max: 1800,
    },
    { name: 'sort_order', label: t('Sort order'), min: -100000, max: 100000 },
  ] as const

  return (
    <Form {...form}>
      <form
        className='space-y-4'
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <p className='text-muted-foreground text-sm'>
          {t(
            'The platform pays for these tests. New plans are paused until enabled or run manually.'
          )}
        </p>
        <FormField
          control={form.control}
          name='name'
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('Name')}</FormLabel>
              <FormControl>
                <Input {...field} maxLength={128} />
              </FormControl>
              <FormMessage>
                {fieldState.error && t('Invalid showcase plan settings')}
              </FormMessage>
            </FormItem>
          )}
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='group'
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>{t('Group Name')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={(groups.data ?? []).map((value) => ({
                      value,
                      label: value,
                    }))}
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value ?? '')
                      form.setValue('model', '')
                    }}
                    onBlur={field.onBlur}
                    placeholder={t('Choose an existing group')}
                    className='w-full'
                    disabled={groups.isPending || groups.isError}
                  />
                </FormControl>
                <FormMessage>
                  {fieldState.error && t('Choose an existing group')}
                </FormMessage>
                {groups.isError && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => void groups.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                )}
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='model'
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>{t('Model')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={(models.data ?? []).map((value) => ({
                      value,
                      label: value,
                    }))}
                    value={field.value}
                    onValueChange={(value) => field.onChange(value ?? '')}
                    onBlur={field.onBlur}
                    disabled={!group || models.isPending || models.isError}
                    placeholder={t('Choose a test model')}
                    className='w-full'
                  />
                </FormControl>
                <FormMessage>
                  {fieldState.error && t('Invalid showcase plan settings')}
                </FormMessage>
                {models.isError && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => void models.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                )}
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name='prompt'
          render={({ field, fieldState }) => (
            <FormItem>
              <FormLabel>{t('Prompt')}</FormLabel>
              <FormControl>
                <Textarea {...field} rows={5} />
              </FormControl>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'A shared HTML/SVG animation instruction is appended and saved with every result.'
                )}
              </p>
              <FormMessage>
                {fieldState.error && t('Invalid showcase plan settings')}
              </FormMessage>
            </FormItem>
          )}
        />
        <div className='grid gap-4 sm:grid-cols-2'>
          {numberFields.map((item) => (
            <FormField
              key={item.name}
              control={form.control}
              name={item.name}
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{item.label}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={item.min}
                      max={item.max}
                      step={1}
                      {...field}
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(event) =>
                        field.onChange(event.target.valueAsNumber)
                      }
                    />
                  </FormControl>
                  <FormMessage>
                    {fieldState.error && t('Invalid showcase plan settings')}
                  </FormMessage>
                </FormItem>
              )}
            />
          ))}
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between rounded-lg border p-3'>
                <FormLabel>{t('Enable scheduled tests')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='public'
            render={({ field }) => (
              <FormItem className='flex items-center justify-between rounded-lg border p-3'>
                <FormLabel>{t('Show publicly')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
        <div className='flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={save.isPending}
            onClick={props.onCancel}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' disabled={save.isPending}>
            {save.isPending ? t('Saving...') : t('Save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
