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
/**
 * Administrator-configured embedded pages (系统设置 → 自定义页面).
 *
 * The backend owns validation; this module only normalizes the API payload and
 * derives the console link for each entry, so the sidebar and the embed page
 * always resolve the same slug.
 */
export type CustomPage = {
  name: string
  url: string
  adminOnly: boolean
}

export type CustomPageLink = CustomPage & {
  /** Identifier used in the console URL, derived from the name. */
  slug: string
  /** Console path that embeds this page. */
  href: string
}

const MAX_SLUG_LENGTH = 40

export function customPageSlug(name: string, index: number): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
  // Chinese page names slugify to nothing; fall back to the position so the
  // entry still gets a stable, unique link.
  return slug || `page-${index + 1}`
}

export function normalizeCustomPages(value: unknown): CustomPage[] {
  if (!Array.isArray(value)) return []

  const pages: CustomPage[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Partial<Record<keyof CustomPage, unknown>>
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    const url = typeof candidate.url === 'string' ? candidate.url.trim() : ''
    if (!name || !url) continue
    pages.push({ name, url, adminOnly: candidate.adminOnly === true })
  }
  return pages
}

export function buildCustomPageLinks(pages: CustomPage[]): CustomPageLink[] {
  const usedSlugs = new Set<string>()
  return pages.map((page, index) => {
    const base = customPageSlug(page.name, index)
    let slug = base
    let suffix = 2
    while (usedSlugs.has(slug)) {
      slug = `${base}-${suffix}`
      suffix += 1
    }
    usedSlugs.add(slug)
    return { ...page, slug, href: `/embed/${slug}` }
  })
}

/** Parses the stored option value; the settings form starts from this list. */
export function parseCustomPagesOption(raw: string): CustomPage[] {
  if (!raw.trim()) return []
  try {
    return normalizeCustomPages(JSON.parse(raw))
  } catch {
    return []
  }
}

/** Serializes the settings form back into the option value. */
export function serializeCustomPages(pages: CustomPage[]): string {
  return JSON.stringify(pages)
}

export const MAX_CUSTOM_PAGES = 20
export const MAX_CUSTOM_PAGE_NAME_LENGTH = 30
