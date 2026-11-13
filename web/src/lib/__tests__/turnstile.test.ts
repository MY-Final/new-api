import { expect, test } from 'vitest'

import { isTurnstileRequired, type TurnstileScene } from '../turnstile'

const scenes: TurnstileScene[] = [
  'login',
  'register',
  'email_verification',
  'password_reset',
  'checkin',
]

test.each(scenes)(
  'legacy status requires %s while its explicit switch can disable it',
  (scene) => {
    const status = { turnstile_check: true, turnstile_site_key: 'site-key' }
    expect(isTurnstileRequired(status, scene)).toBe(true)
    expect(
      isTurnstileRequired(
        { ...status, turnstile_scenes: { [scene]: false } },
        scene
      )
    ).toBe(false)
    expect(
      isTurnstileRequired({ ...status, turnstile_check: false }, scene)
    ).toBe(false)
    expect(
      isTurnstileRequired({ ...status, turnstile_site_key: '' }, scene)
    ).toBe(false)
    expect(isTurnstileRequired(undefined, scene)).toBe(false)
  }
)
