import type { TFunction } from 'i18next'

export function getSourceLabel(source: string, t: TFunction) {
  if (source === 'all') return t('All sources')
  if (source === 'signup') return t('Registration')
  if (source === 'topup') return t('Top-up')
  if (source === 'redemption') return t('Redemption code')
  return source
}

export function getSourceOptions(t: TFunction) {
  return [
    { value: 'all', label: t('All sources') },
    { value: 'signup', label: t('Registration') },
    { value: 'topup', label: t('Top-up') },
    { value: 'redemption', label: t('Redemption code') },
  ]
}

export function getStatusLabel(status: string, t: TFunction) {
  if (status === 'all') return t('All statuses')
  if (status === 'settled') return t('Settled')
  if (status === 'reversed') return t('Reversed')
  return status
}

export function getStatusOptions(t: TFunction) {
  return [
    { value: 'all', label: t('All statuses') },
    { value: 'settled', label: t('Settled') },
    { value: 'reversed', label: t('Reversed') },
  ]
}
