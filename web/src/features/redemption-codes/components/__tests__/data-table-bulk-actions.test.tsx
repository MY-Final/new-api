/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import type { Table } from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import type { Redemption } from '../../types'
import { DataTableBulkActions } from '../data-table-bulk-actions'
import { RedemptionsProvider } from '../redemptions-provider'

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Change name': 'Change name',
        'Change quota': 'Change quota',
        'Change status': 'Change status',
        'Change type': 'Change type',
        'Choose the fields to update for all selected codes.':
          'Choose the fields to update for all selected codes.',
        'Edit selected redemption codes': 'Edit selected redemption codes',
        Edit: 'Edit',
        'Reward code': 'Reward code',
        Selected: 'Selected',
        Unused: 'Unused',
      },
    },
  },
})

function redemption(): Redemption {
  return {
    id: 1,
    user_id: 1,
    name: 'batch-code',
    key: 'batch-code-key',
    status: 1,
    quota: 500000,
    created_time: 1,
    redeemed_time: 0,
    expired_time: 0,
    used_user_id: 0,
    type: 'reward',
  }
}

function tableFixture(): Table<Redemption> {
  const row = { original: redemption() }
  return {
    getFilteredSelectedRowModel: () => ({ rows: [row] }),
    getSelectedRowModel: () => ({ rows: [row] }),
    resetRowSelection: vi.fn(),
  } as unknown as Table<Redemption>
}

describe('redemption batch action editor', () => {
  test('shows full-width select controls below their field labels', async () => {
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <RedemptionsProvider>
          <DataTableBulkActions table={tableFixture()} />
        </RedemptionsProvider>
      </I18nextProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(
      screen.getByRole('heading', { name: 'Edit selected redemption codes' })
    ).toBeInTheDocument()
    const typeSelect = screen.getByRole('combobox', {
      name: 'Change type',
    })
    expect(typeSelect).toHaveClass('w-full')
    expect(typeSelect.parentElement).toHaveClass('pl-7')
  })
})
