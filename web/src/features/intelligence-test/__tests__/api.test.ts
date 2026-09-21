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
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ApiKey } from '@/features/keys/types'

import {
  filterModelsForKey,
  normalizeOpenAIBaseUrl,
  resolveConnection,
  sendModelRequest,
  sendStreamingModelRequest,
} from '../api'
import type { ChatCompletionPayload } from '../types'

const mocks = vi.hoisted(() => ({
  fetchTokenKey: vi.fn(),
}))

vi.mock('@/features/keys/api', () => ({
  fetchTokenKey: mocks.fetchTokenKey,
  getApiKeys: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeOpenAIBaseUrl', () => {
  test.each([
    ['https://api.example.com', 'https://api.example.com/v1'],
    ['https://api.example.com/', 'https://api.example.com/v1'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    [
      'https://api.example.com/v1/chat/completions',
      'https://api.example.com/v1',
    ],
    ['https://api.example.com/v1/?debug=1#top', 'https://api.example.com/v1'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeOpenAIBaseUrl(input)).toBe(expected)
  })

  test('rejects non-HTTPS addresses', () => {
    expect(() => normalizeOpenAIBaseUrl('http://api.example.com')).toThrow(
      'The custom API address must use HTTPS.'
    )
  })

  test('rejects embedded credentials', () => {
    expect(() =>
      normalizeOpenAIBaseUrl('https://user:pass@api.example.com')
    ).toThrow('Credentials must not be embedded in the API address.')
  })
})

describe('resolveConnection', () => {
  test('normalizes a custom connection without touching storage', async () => {
    const connection = await resolveConnection({
      kind: 'custom',
      name: 'Third party',
      baseUrl: 'https://api.example.com/v1/',
      model: 'gpt-test',
      apiKey: 'sk-custom',
    })

    expect(connection).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-custom',
      model: 'gpt-test',
      kind: 'custom',
    })
  })

  test('loads a platform key from the same origin', async () => {
    mocks.fetchTokenKey.mockResolvedValue({
      success: true,
      data: { key: 'platform-token' },
    })

    const connection = await resolveConnection({
      kind: 'platform',
      keyId: 3,
      keyName: 'Primary',
      group: 'default',
      model: 'gpt-test',
    })

    expect(mocks.fetchTokenKey).toHaveBeenCalledWith(3)
    expect(connection.baseUrl).toBe(`${window.location.origin}/v1`)
    expect(connection.apiKey).toBe('sk-platform-token')
    expect(connection.kind).toBe('platform')
  })
})

describe('sendStreamingModelRequest', () => {
  const payload: ChatCompletionPayload = {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    max_tokens: 1024,
  }
  const connection = {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret',
    model: 'gpt-test',
    kind: 'custom' as const,
  }

  function streamResponse(chunks: string[]) {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    })
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
    }
  }

  test('accumulates SSE deltas and reports received characters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
          ': keepalive\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n',
        ])
      )
    vi.stubGlobal('fetch', fetchMock)

    const progress: number[] = []
    const content = await sendStreamingModelRequest(
      connection,
      payload,
      new AbortController().signal,
      1000,
      (receivedChars) => progress.push(receivedChars)
    )

    expect(content).toBe('hello world')
    expect(progress).toEqual([5, 11])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true)
  })

  test('handles an SSE event split across network chunks', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamResponse([
            'data: {"choices":[{"delta":{"con',
            'tent":"split"}}]}\n\ndata: [DONE]\n\n',
          ])
        )
    )

    const content = await sendStreamingModelRequest(
      connection,
      payload,
      new AbortController().signal,
      1000
    )

    expect(content).toBe('split')
  })

  test('surfaces an in-band stream error and redacts the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          streamResponse([
            'data: {"error":{"message":"bad key sk-secret"}}\n\n',
          ])
        )
    )

    await expect(
      sendStreamingModelRequest(
        connection,
        payload,
        new AbortController().signal,
        1000
      )
    ).rejects.toThrow('bad key [redacted]')
  })

  test('falls back to a JSON body when the gateway ignores streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{ message: { content: 'plain result' } }],
        }),
      })
    )

    const content = await sendStreamingModelRequest(
      connection,
      payload,
      new AbortController().signal,
      1000
    )

    expect(content).toBe('plain result')
  })

  test('rejects an empty streamed response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(streamResponse(['data: [DONE]\n\n']))
    )

    await expect(
      sendStreamingModelRequest(
        connection,
        payload,
        new AbortController().signal,
        1000
      )
    ).rejects.toThrow('The model returned an empty response.')
  })
})

describe('sendModelRequest', () => {
  const payload: ChatCompletionPayload = {
    model: 'gpt-test',
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    max_tokens: 1024,
  }

  test('posts the OpenAI chat completion body to the resolved URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'result' } }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const content = await sendModelRequest(
      {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret',
        model: 'gpt-test',
        kind: 'custom',
      },
      payload,
      new AbortController().signal,
      1000
    )

    expect(content).toBe('result')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-secret')
    expect(JSON.parse(init.body)).toEqual(payload)
  })

  test('redacts the API key from upstream error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid key sk-secret' } }),
      })
    )

    await expect(
      sendModelRequest(
        {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-secret',
          model: 'gpt-test',
          kind: 'custom',
        },
        payload,
        new AbortController().signal,
        1000
      )
    ).rejects.toThrow('Invalid key [redacted]')
  })

  test('fails when the model returns empty content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '  ' } }] }),
      })
    )

    await expect(
      sendModelRequest(
        {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-secret',
          model: 'gpt-test',
          kind: 'custom',
        },
        payload,
        new AbortController().signal,
        1000
      )
    ).rejects.toThrow('The model returned an empty response.')
  })

  test('explains network and CORS failures for custom endpoints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )

    await expect(
      sendModelRequest(
        {
          baseUrl: 'https://api.example.com/v1',
          apiKey: 'sk-secret',
          model: 'gpt-test',
          kind: 'custom',
        },
        payload,
        new AbortController().signal,
        1000
      )
    ).rejects.toThrow(
      'The request failed. Check the endpoint address, network, and CORS settings.'
    )
  })

  test('attributes a dropped platform connection to gateway timeouts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    )

    await expect(
      sendModelRequest(
        {
          baseUrl: `${window.location.origin}/v1`,
          apiKey: 'sk-secret',
          model: 'gpt-test',
          kind: 'platform',
        },
        payload,
        new AbortController().signal,
        1000
      )
    ).rejects.toThrow(
      'The connection was interrupted. The upstream or a gateway may have timed out; check the proxy timeout settings.'
    )
  })
})

describe('filterModelsForKey', () => {
  const key = {
    model_limits_enabled: false,
    model_limits: '',
  } as ApiKey

  test('keeps every model when limits are disabled', () => {
    expect(filterModelsForKey(['a', 'b'], key)).toEqual(['a', 'b'])
  })

  test('intersects with the configured model limits', () => {
    expect(
      filterModelsForKey(['a', 'b', 'c'], {
        ...key,
        model_limits_enabled: true,
        model_limits: 'b, c',
      })
    ).toEqual(['b', 'c'])
  })
})
