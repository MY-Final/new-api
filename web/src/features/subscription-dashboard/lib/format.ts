import { formatBillingCurrencyFromUSD } from '@/lib/currency'

/**
 * The overview API reports every amount in USD. Convert it with the configured
 * site currency here instead of appending a currency label to the raw number.
 */
export function formatOverviewMoney(
  value: number | undefined,
  locale?: Intl.LocalesArgument
): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return formatBillingCurrencyFromUSD(value, {
    locale,
    digitsLarge: 2,
    digitsSmall: 6,
    abbreviate: false,
  })
}
