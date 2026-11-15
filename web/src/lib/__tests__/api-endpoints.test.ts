import { describe, expect, it } from 'vitest'

import {
  getAPIBaseEndpoints,
  parseAPIBaseEndpointsOption,
  serializeAPIBaseEndpointsOption,
} from '../api-endpoints'

describe('API endpoint configuration', () => {
  it('reads labeled endpoints and keeps their order', () => {
    const value = JSON.stringify([
      { name: ' 默认 ', url: ' https://api.example.com ' },
      { name: '直连', url: 'https://direct.example.com' },
    ])

    expect(parseAPIBaseEndpointsOption(value)).toEqual([
      { name: '默认', url: 'https://api.example.com' },
      { name: '直连', url: 'https://direct.example.com' },
    ])
  })

  it('converts the legacy newline format into unnamed endpoints', () => {
    expect(
      parseAPIBaseEndpointsOption(
        'https://api.example.com\n\nhttps://direct.example.com/'
      )
    ).toEqual([
      { name: '', url: 'https://api.example.com' },
      { name: '', url: 'https://direct.example.com/' },
    ])
  })

  it('drops invalid and duplicate endpoint URLs', () => {
    expect(
      getAPIBaseEndpoints(
        [
          { name: 'Default', url: 'https://api.example.com' },
          { name: 'Duplicate', url: 'https://api.example.com' },
          {
            name: 'Insecure credentials',
            url: 'https://user:pass@example.com',
          },
          { name: 'Query', url: 'https://example.com?token=secret' },
          { name: 'Invalid', url: 'javascript:alert(1)' },
        ],
        ['https://ignored.example.com']
      )
    ).toEqual([{ name: 'Default', url: 'https://api.example.com' }])
  })

  it('falls back to legacy URL status when labels are unavailable', () => {
    expect(
      getAPIBaseEndpoints(undefined, [
        'https://api.example.com',
        'https://direct.example.com',
      ])
    ).toEqual([
      { name: '', url: 'https://api.example.com' },
      { name: '', url: 'https://direct.example.com' },
    ])
  })

  it('serializes labeled rows as JSON and removes trailing slashes', () => {
    expect(
      serializeAPIBaseEndpointsOption([
        { name: ' 默认 ', url: 'https://api.example.com/' },
        { name: '直连', url: 'https://direct.example.com/gateway/' },
      ])
    ).toBe(
      '[{"name":"默认","url":"https://api.example.com"},{"name":"直连","url":"https://direct.example.com/gateway"}]'
    )
  })
})
