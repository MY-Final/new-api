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

import { ASPECT_RATIO_VALUES, RESOLUTIONS } from '../../constants'
import { getImageSize, parseImageSize } from '../size'

describe('canvas size mapping', () => {
  test('sets the long edge from the resolution tier', () => {
    expect(getImageSize('1:1', '1024P')).toBe('1024x1024')
    expect(getImageSize('4:3', '1024P')).toBe('1024x768')
    expect(getImageSize('16:9', '1024P')).toBe('1024x576')
    expect(getImageSize('9:16', '1024P')).toBe('576x1024')
    expect(getImageSize('1:1', '4K')).toBe('4096x4096')
    expect(getImageSize('16:9', '4K')).toBe('4096x2304')
  })

  test('omits the size for the auto ratio and rejects unknown inputs', () => {
    expect(getImageSize('auto', '1024P')).toBeUndefined()
    expect(getImageSize('5:4', '1024P')).toBeUndefined()
    expect(getImageSize('1:1', '8K')).toBeUndefined()
  })

  test('never exceeds the tier and keeps sides on the 16px grid', () => {
    for (const aspectRatio of ASPECT_RATIO_VALUES) {
      if (aspectRatio === 'auto') continue
      for (const tier of RESOLUTIONS) {
        const size = getImageSize(aspectRatio, tier.value)
        expect(size).toBeDefined()
        if (!size) continue
        const [width, height] = size.split('x').map(Number)
        expect(Math.max(width, height)).toBe(tier.longEdge)
        expect(Math.min(width, height) % 16).toBe(0)
      }
    }
  })

  test('parses every generated size back to its ratio and tier', () => {
    for (const aspectRatio of ASPECT_RATIO_VALUES) {
      if (aspectRatio === 'auto') continue
      for (const tier of RESOLUTIONS) {
        const size = getImageSize(aspectRatio, tier.value)
        expect(size).toBeDefined()
        if (!size) continue
        expect(parseImageSize(size)).toEqual({
          aspectRatio,
          resolution: tier.value,
        })
      }
    }
  })

  test('treats non-preset values as custom sizes', () => {
    expect(parseImageSize('1792x1024')).toBeNull()
    expect(parseImageSize('auto')).toBeNull()
    expect(parseImageSize('')).toBeNull()
  })
})
