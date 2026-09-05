import { createFileRoute } from '@tanstack/react-router'

import { AffiliateRebates } from '@/features/affiliate-rebates'

export const Route = createFileRoute('/_authenticated/affiliate-rebates/')({
  component: AffiliateRebates,
})
