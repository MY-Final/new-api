/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { describe, expect, test } from 'vitest'

import {
  transformFormDataToPayload,
  transformUserToFormDefaults,
  USER_FORM_DEFAULT_VALUES,
  userFormSchema,
} from '../user-form'

describe('user concurrency form mapping', () => {
  test('defaults to no account-level limit', () => {
    expect(USER_FORM_DEFAULT_VALUES.max_concurrency).toBe(0)
    expect(
      transformFormDataToPayload({
        ...USER_FORM_DEFAULT_VALUES,
        username: 'limited-user',
      }).max_concurrency
    ).toBe(0)
  })

  test('preserves a positive limit when editing a user', () => {
    const values = transformUserToFormDefaults({
      id: 7,
      username: 'limited-user',
      display_name: 'Limited User',
      role: 1,
      quota: 0,
      used_quota: 0,
      request_count: 0,
      group: 'default',
      max_concurrency: 6,
      status: 1,
    })

    expect(values.max_concurrency).toBe(6)
    expect(transformFormDataToPayload(values, 7).max_concurrency).toBe(6)
  })

  test('rejects negative and fractional limits', () => {
    expect(
      userFormSchema.safeParse({
        ...USER_FORM_DEFAULT_VALUES,
        username: 'invalid-user',
        max_concurrency: -1,
      }).success
    ).toBe(false)
    expect(
      userFormSchema.safeParse({
        ...USER_FORM_DEFAULT_VALUES,
        username: 'invalid-user',
        max_concurrency: 1.5,
      }).success
    ).toBe(false)
  })
})
