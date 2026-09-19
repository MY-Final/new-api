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
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { LedgerFilterBar } from '../components/ledger-filter-bar'

describe('LedgerFilterBar', () => {
  test('reports username edits and clears active filters', () => {
    const onUsernameChange = vi.fn()
    const onClear = vi.fn()
    const range = { start: new Date(2026, 0, 5), end: new Date(2026, 0, 6) }

    render(
      <LedgerFilterBar
        start={range.start}
        end={range.end}
        username='alice'
        onRangeChange={() => undefined}
        onUsernameChange={onUsernameChange}
        onClear={onClear}
      />
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Search username' }), {
      target: { value: 'bob' },
    })
    expect(onUsernameChange).toHaveBeenCalledWith('bob')

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  test('hides the clear action when no filter is active', () => {
    render(
      <LedgerFilterBar
        username=''
        onRangeChange={() => undefined}
        onUsernameChange={() => undefined}
        onClear={() => undefined}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Clear filters' })
    ).not.toBeInTheDocument()
  })
})
