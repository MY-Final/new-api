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
import { describe, expect, it } from 'vitest'

import {
  buildCustomPageLinks,
  customPageSlug,
  normalizeCustomPages,
  parseCustomPagesOption,
  serializeCustomPages,
} from '../custom-pages'

describe('custom page links', () => {
  it('derives a slug from the name and falls back for non-latin names', () => {
    expect(customPageSlug('Status Page', 0)).toBe('status-page')
    expect(customPageSlug('  监控 大屏  ', 1)).toBe('page-2')
  })

  it('keeps duplicate slugs unique so every entry opens its own page', () => {
    const links = buildCustomPageLinks([
      { name: 'Status', url: 'https://a.example.com', adminOnly: false },
      { name: 'status', url: 'https://b.example.com', adminOnly: true },
    ])

    expect(links.map((link) => link.slug)).toEqual(['status', 'status-2'])
    expect(links.map((link) => link.href)).toEqual([
      '/embed/status',
      '/embed/status-2',
    ])
    expect(links[1].adminOnly).toBe(true)
  })
})

describe('custom page payload handling', () => {
  it('drops malformed entries from an API payload', () => {
    expect(
      normalizeCustomPages([
        { name: ' ok ', url: ' https://a.example.com ', adminOnly: true },
        { name: '', url: 'https://missing-name.example.com' },
        { name: 'missing url' },
        null,
        'not an entry',
      ])
    ).toEqual([
      { name: 'ok', url: 'https://a.example.com', adminOnly: true },
    ])

    expect(normalizeCustomPages('nope')).toEqual([])
  })

  it('round-trips the stored option value', () => {
    const pages = [
      { name: '监控', url: 'https://mon.example.com', adminOnly: true },
    ]
    expect(parseCustomPagesOption(serializeCustomPages(pages))).toEqual(pages)
    expect(parseCustomPagesOption('')).toEqual([])
    expect(parseCustomPagesOption('not json')).toEqual([])
  })
})
