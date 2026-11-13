export interface ShowcasePlan {
  id: number
  name: string
  group: string
  model: string
  prompt: string
  interval_minutes: number
  keep_count: number
  max_output_tokens: number
  timeout_seconds: number
  enabled: boolean
  public: boolean
  sort_order: number
  next_run_at: number
  run_requested: boolean
}

export interface ShowcaseRun {
  id: number
  plan_id: number
  name: string
  group: string
  model: string
  prompt?: string
  output?: string
  status: 'running' | 'succeeded' | 'failed'
  error?: string
  started_at: number
  completed_at: number
  duration_ms: number
  prompt_tokens: number
  completion_tokens: number
}

export interface ShowcaseEntry extends ShowcasePlan {
  runs: ShowcaseRun[]
}
