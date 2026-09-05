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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import { TransferDialog } from '../transfer-dialog'

describe('TransferDialog', () => {
  test('caps an amount above available rewards to the available quota', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true)
    const user = userEvent.setup()

    render(
      <I18nextProvider i18n={i18next}>
        <TransferDialog
          open
          onOpenChange={vi.fn()}
          onConfirm={onConfirm}
          availableQuota={750000}
          transferring={false}
        />
      </I18nextProvider>
    )

    const amount = screen.getByLabelText('Transfer Amount')
    await user.clear(amount)
    await user.type(amount, '2')
    await user.click(screen.getByRole('button', { name: 'Transfer' }))

    expect(onConfirm).toHaveBeenCalledWith(750000)
  })
})
