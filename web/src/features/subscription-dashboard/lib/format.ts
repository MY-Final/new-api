import { getCurrencyLabel } from '@/lib/currency'

/**
 * Order money is already stored in the billing currency. Show the amount as-is
 * with the current display currency label instead of routing it through quota
 * conversion, which would apply the USD exchange rate a second time.
 */
export function formatOverviewMoney(
  value: number | undefined,
  locale?: Intl.LocalesArgument
): string {
  if (value == null || !Number.isFinite(value)) return '-'
  // `formatNumber` caps at two decimals, which would display a small upstream
  // cost as 0. Keep up to six decimals for sub-unit amounts.
  const maximumFractionDigits = value !== 0 && Math.abs(value) < 1 ? 6 : 2
  const amount = new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(value)
  return `${amount} ${getCurrencyLabel()}`
}
