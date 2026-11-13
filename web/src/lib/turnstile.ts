export type TurnstileScene =
  | 'login'
  | 'register'
  | 'email_verification'
  | 'password_reset'
  | 'checkin'

type TurnstileStatus = {
  turnstile_check?: boolean
  turnstile_site_key?: string
  turnstile_scenes?: Partial<Record<TurnstileScene, boolean>>
}

export function isTurnstileRequired(
  status: TurnstileStatus | null | undefined,
  scene: TurnstileScene
): boolean {
  return Boolean(
    status?.turnstile_check &&
    status.turnstile_site_key &&
    status.turnstile_scenes?.[scene] !== false
  )
}
