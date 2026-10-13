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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'

import { TicketSelect } from '../components/ticket-select'
import { ticketCategories } from '../constants'

function CategorySelect() {
  const [value, setValue] = useState('api')
  return (
    <TicketSelect
      label='Category'
      value={value}
      options={ticketCategories}
      onChange={setValue}
    />
  )
}

it('uses the full field width and opens options below the trigger', async () => {
  const user = userEvent.setup()
  render(<CategorySelect />)
  const trigger = screen.getByRole('combobox', { name: 'Category' })
  expect(trigger).toHaveClass('w-full')
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  const option = await screen.findByRole('option', {
    name: 'Payments and orders',
  })
  expect(option.closest('[data-slot=select-content]')).toHaveAttribute(
    'data-align-trigger',
    'false'
  )
  await user.click(option)
  expect(trigger).toHaveTextContent('Payments and orders')
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('supports selecting a category with the keyboard', async () => {
  const user = userEvent.setup()
  render(<CategorySelect />)
  await user.tab()
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveFocus()
  await user.keyboard('{Enter}')
  const current = await screen.findByRole('option', { name: 'API requests' })
  expect(current).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent(
    'Payments and orders'
  )
})

it('prevents opening a disabled field', async () => {
  const user = userEvent.setup()
  render(
    <TicketSelect
      label='Category'
      value='api'
      options={ticketCategories}
      disabled
      onChange={() => undefined}
    />
  )
  const trigger = screen.getByRole('combobox', { name: 'Category' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
})
