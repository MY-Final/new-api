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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ModelGroupSelector } from '@/components/model-group-selector'

const groups = [
  { label: 'gpt_luna_pool', value: 'gpt_luna_pool', ratio: 1 },
  { label: 'gpt_plus_0.15_group_backup', value: 'gpt_plus', ratio: 1 },
]

const models = [
  { label: 'gpt-5.5', value: 'gpt-5.5' },
  {
    label: 'gpt-6.1-sol-very-long-model-name-for-testing',
    value: 'gpt-6.1-sol',
  },
]

function renderSelector(selected: { group?: string; model?: string } = {}) {
  return render(
    <ModelGroupSelector
      groups={groups}
      models={models}
      onGroupChange={() => undefined}
      onModelChange={() => undefined}
      selectedGroup={selected.group ?? 'gpt_luna_pool'}
      selectedModel={selected.model ?? 'gpt-5.5'}
    />
  )
}

async function openSelector() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox'))
  return user
}

function openTooltip(): Promise<Element> {
  return waitFor(() => {
    const tooltip = document.querySelector("[data-slot='tooltip-content']")
    if (!tooltip) {
      throw new Error('Tooltip did not open')
    }
    return tooltip
  })
}

describe('ModelGroupSelector long names', () => {
  it('reveals the full group name of a truncated option', async () => {
    renderSelector()
    const user = await openSelector()

    // Hover the label itself, which is what the mouse reaches in the list.
    await user.hover(await screen.findByText('gpt_plus_0.15_group_backup'))

    expect(await openTooltip()).toHaveTextContent('gpt_plus_0.15_group_backup')
  })

  it('reveals the full model name of a truncated option', async () => {
    renderSelector()
    const user = await openSelector()

    await user.hover(
      await screen.findByText('gpt-6.1-sol-very-long-model-name-for-testing')
    )

    expect(await openTooltip()).toHaveTextContent(
      'gpt-6.1-sol-very-long-model-name-for-testing'
    )
  })

  it('reveals the full group name on the trigger', async () => {
    renderSelector({ group: 'gpt_plus' })
    const user = userEvent.setup()

    // The trigger label is truncated too, so hovering it is the only way to
    // read the selected group without opening the popover.
    const trigger = screen.getByRole('combobox')
    await user.hover(
      await screen.findByText('gpt_plus_0.15_group_backup', {
        selector: '[role=combobox] *',
      })
    )

    expect(trigger).toBeInTheDocument()
    expect(await openTooltip()).toHaveTextContent('gpt_plus_0.15_group_backup')
  })
})
