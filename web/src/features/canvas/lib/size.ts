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
import { RESOLUTIONS } from '../constants'

const RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1, height: 1 },
  '4:3': { width: 4, height: 3 },
  '3:2': { width: 3, height: 2 },
  '16:9': { width: 16, height: 9 },
  '21:9': { width: 21, height: 9 },
  '3:4': { width: 3, height: 4 },
  '2:3': { width: 2, height: 3 },
  '9:16': { width: 9, height: 16 },
}

const SIDE_MULTIPLE = 16
const MIN_SIDE = 64

function snapSide(value: number): number {
  const rounded = Math.round(value / SIDE_MULTIPLE) * SIDE_MULTIPLE
  return Math.max(MIN_SIDE, rounded)
}

/**
 * Resolve the `size` sent to the relay from an aspect ratio and a resolution
 * tier. The tier sets the long edge, so wide ratios never exceed it. `auto`
 * omits the size entirely and lets the model decide its own dimensions.
 */
export function getImageSize(
  aspectRatio: string,
  resolution: string
): string | undefined {
  if (aspectRatio === 'auto') return undefined
  const ratio = RATIO_DIMENSIONS[aspectRatio]
  const tier = RESOLUTIONS.find((item) => item.value === resolution)
  if (!ratio || !tier) return undefined

  const longEdge = tier.longEdge
  let width: number
  let height: number
  if (ratio.width >= ratio.height) {
    width = longEdge
    height = snapSide((longEdge * ratio.height) / ratio.width)
  } else {
    height = longEdge
    width = snapSide((longEdge * ratio.width) / ratio.height)
  }
  return `${width}x${height}`
}

/**
 * Reverse `getImageSize` for history and restore payloads. Snapped sides mean
 * the pixel size is not always the exact reduced ratio, so search the known
 * combinations instead of re-deriving them. Returns null for custom sizes.
 */
export function parseImageSize(
  size: string
): { aspectRatio: string; resolution: string } | null {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/.exec(size)
  if (!match) return null
  const normalized = `${Number(match[1])}x${Number(match[2])}`
  for (const aspectRatio of Object.keys(RATIO_DIMENSIONS)) {
    for (const tier of RESOLUTIONS) {
      if (getImageSize(aspectRatio, tier.value) === normalized) {
        return { aspectRatio, resolution: tier.value }
      }
    }
  }
  return null
}
