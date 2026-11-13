import { z } from 'zod'

export const planSchema = z.object({
  name: z.string().trim().min(1).max(128),
  group: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((group) => group !== 'auto'),
  model: z.string().trim().min(1).max(255),
  prompt: z
    .string()
    .trim()
    .min(1)
    .refine((prompt) => new TextEncoder().encode(prompt).length <= 16000),
  interval_minutes: z.number().int().min(1).max(10080),
  keep_count: z.number().int().min(1).max(100),
  max_output_tokens: z.number().int().min(128).max(32768),
  timeout_seconds: z.number().int().min(30).max(1800),
  sort_order: z.number().int().min(-100000).max(100000),
  enabled: z.boolean(),
  public: z.boolean(),
})

export type PlanValues = z.infer<typeof planSchema>
