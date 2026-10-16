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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { refundReasons } from '../lib/request-refund'

export function RefundReasonFields(props: {
  id: string
  reason: string
  details: string
  onReasonChange: (value: string) => void
  onDetailsChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <FieldGroup>
      <Field data-disabled={props.disabled}>
        <FieldLabel htmlFor={props.id}>{t('Refund reason')} *</FieldLabel>
        <Select
          items={refundReasons.map((reason) => ({
            value: reason,
            label: t(reason),
          }))}
          value={props.reason || null}
          required
          disabled={props.disabled}
          onValueChange={(value) => {
            props.onReasonChange(value ?? '')
            props.onDetailsChange('')
          }}
        >
          <SelectTrigger id={props.id} className='w-full' aria-required='true'>
            <SelectValue placeholder={t('Select a refund reason')} />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {refundReasons.map((reason) => (
                <SelectItem key={reason} value={reason}>
                  {t(reason)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {props.reason === 'Other reason' ? (
        <Field data-disabled={props.disabled}>
          <FieldLabel htmlFor={`${props.id}-details`}>
            {t('Additional details')} ({t('Optional')})
          </FieldLabel>
          <Input
            id={`${props.id}-details`}
            value={props.details}
            maxLength={241}
            disabled={props.disabled}
            onChange={(event) => props.onDetailsChange(event.target.value)}
          />
        </Field>
      ) : null}
    </FieldGroup>
  )
}

export function RefundReasonBadge(props: { reason?: string }) {
  const { t } = useTranslation()
  if (!props.reason) return <span>—</span>
  const category = refundReasons.find(
    (reason) =>
      reason === props.reason ||
      (reason === 'Other reason' && props.reason?.startsWith(`${reason}: `))
  )
  const details =
    category === 'Other reason' ? props.reason.slice(category.length + 2) : ''
  return (
    <div className='min-w-0 space-y-1 whitespace-normal'>
      <StatusBadge
        copyable={false}
        variant='neutral'
        className='bg-muted'
        label={category ? t(category) : props.reason}
      />
      {details ? (
        <p className='text-muted-foreground text-xs break-all'>{details}</p>
      ) : null}
    </div>
  )
}
