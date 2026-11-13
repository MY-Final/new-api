import { createFileRoute } from '@tanstack/react-router'

import { ModelShowcase } from '@/features/model-showcase'

export const Route = createFileRoute('/showcase/')({
  component: ModelShowcase,
})
