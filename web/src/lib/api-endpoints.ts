export type APIBaseEndpoint = {
  name: string
  url: string
}

export const MAX_API_BASE_ENDPOINTS = 20

export function isValidAPIBaseEndpointURL(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function getAPIBaseEndpoints(
  endpointsValue: unknown,
  urlsValue?: unknown
): APIBaseEndpoint[] {
  const endpoints: APIBaseEndpoint[] = []
  const seenURLs = new Set<string>()

  const append = (nameValue: unknown, urlValue: unknown) => {
    if (endpoints.length >= MAX_API_BASE_ENDPOINTS) return
    if (typeof urlValue !== 'string') return
    const url = urlValue.trim()
    if (!url || seenURLs.has(url) || !isValidAPIBaseEndpointURL(url)) return
    seenURLs.add(url)
    endpoints.push({
      name: typeof nameValue === 'string' ? nameValue.trim() : '',
      url,
    })
  }

  if (Array.isArray(endpointsValue)) {
    for (const endpoint of endpointsValue) {
      if (!endpoint || typeof endpoint !== 'object') continue
      const candidate = endpoint as { name?: unknown; url?: unknown }
      append(candidate.name, candidate.url)
    }
  }

  if (endpoints.length === 0 && Array.isArray(urlsValue)) {
    for (const url of urlsValue) {
      append('', url)
    }
  }

  return endpoints
}

export function parseAPIBaseEndpointsOption(value: string): APIBaseEndpoint[] {
  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      return getAPIBaseEndpoints(JSON.parse(trimmed))
    } catch {
      return []
    }
  }

  return getAPIBaseEndpoints(
    undefined,
    value
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean)
  )
}

export function serializeAPIBaseEndpointsOption(value: unknown): string {
  const endpoints = getAPIBaseEndpoints(value).map((endpoint) => ({
    ...endpoint,
    url: endpoint.url.replace(/\/+$/, ''),
  }))
  return JSON.stringify(endpoints)
}
