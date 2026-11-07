import { createFileRoute } from '@tanstack/react-router'

import { EntertainmentCheckin } from '@/features/entertainment/checkin'

export const Route = createFileRoute('/_authenticated/entertainment/checkin')({
  component: EntertainmentCheckin,
})
