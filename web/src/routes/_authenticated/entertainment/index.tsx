import { createFileRoute } from '@tanstack/react-router'

import { Entertainment } from '@/features/entertainment'

export const Route = createFileRoute('/_authenticated/entertainment/')({
  component: Entertainment,
})
