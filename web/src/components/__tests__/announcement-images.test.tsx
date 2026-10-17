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
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AnnouncementImages } from '../announcement-images'

describe('AnnouncementImages', () => {
  it('renders nothing when there are no images', () => {
    const { container } = render(<AnnouncementImages images={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('loads each image through the console image endpoint', () => {
    render(<AnnouncementImages images={[12, 34]} />)

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', '/api/console-images/12')
    expect(images[1]).toHaveAttribute('src', '/api/console-images/34')
  })

  it('drops an image that fails to load', () => {
    render(<AnnouncementImages images={[12, 34]} />)

    fireEvent.error(screen.getAllByRole('img')[0])

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('src', '/api/console-images/34')
  })

  it('opens a preview and steps through the images', () => {
    render(<AnnouncementImages images={[12, 34]} />)

    fireEvent.click(screen.getAllByRole('button')[0])
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute(
      'src',
      '/api/console-images/12'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute(
      'src',
      '/api/console-images/34'
    )
  })

  it('reports the removed image id', () => {
    const onRemove = vi.fn()
    render(<AnnouncementImages images={[12, 34]} onRemove={onRemove} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove image' })[0])

    expect(onRemove).toHaveBeenCalledWith(12)
  })
})
