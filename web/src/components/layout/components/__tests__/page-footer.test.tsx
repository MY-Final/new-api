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
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { PageFooterPortal } from '../page-footer'
import { SectionPageLayout } from '../section-page-layout'

describe('SectionPageLayout footer', () => {
  test('renders footer portal content after the footer container mounts', async () => {
    render(
      <SectionPageLayout>
        <SectionPageLayout.Content>
          <div>
            <PageFooterPortal>
              <span>Footer content</span>
            </PageFooterPortal>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )

    await waitFor(() =>
      expect(screen.getByText('Footer content')).toBeInTheDocument()
    )
  })
})
