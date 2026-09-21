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
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import type { ApiKey } from '@/features/keys/types'
import { api } from '@/lib/api'

import type {
  ChatCompletionPayload,
  ChatCompletionResponse,
  ConnectionConfig,
  ConnectionKind,
} from './types'

export interface ResolvedConnection {
  baseUrl: string
  apiKey: string
  model: string
  kind: ConnectionKind
}

export class IntelligenceRequestError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'IntelligenceRequestError'
    this.status = status
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function normalizeOpenAIBaseUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:') {
    throw new Error('The custom API address must use HTTPS.')
  }
  if (url.username || url.password) {
    throw new Error('Credentials must not be embedded in the API address.')
  }

  url.hash = ''
  url.search = ''
  const normalized = trimTrailingSlash(url.toString())

  if (normalized.endsWith('/chat/completions')) {
    return normalized.slice(0, -'/chat/completions'.length)
  }
  if (normalized.endsWith('/v1')) {
    return normalized
  }
  return `${normalized}/v1`
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${trimTrailingSlash(baseUrl)}/chat/completions`
}

function redactSecret(message: string, secret: string): string {
  if (!secret) return message
  return message.replaceAll(secret, '[redacted]')
}

function toRequestErrorMessage(
  error: unknown,
  secret: string,
  kind: ConnectionKind
): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'The request was interrupted or timed out.'
  }
  if (error instanceof TypeError) {
    if (kind === 'platform') {
      return 'The connection was interrupted. The upstream or a gateway may have timed out; check the proxy timeout settings.'
    }
    return 'The request failed. Check the endpoint address, network, and CORS settings.'
  }
  if (error instanceof Error) {
    return redactSecret(error.message, secret)
  }
  return 'The model request failed.'
}

interface ChatStreamChunk {
  choices?: Array<{
    delta?: { content?: string }
    message?: { content?: string }
  }>
  error?: { message?: string }
  message?: string
}

async function consumeEventStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (receivedChars: number) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finished = false
  let failure: string | null = null

  const handleData = (data: string) => {
    if (data === '[DONE]') {
      finished = true
      return
    }
    if (!data) return

    let chunk: ChatStreamChunk
    try {
      chunk = JSON.parse(data) as ChatStreamChunk
    } catch {
      return
    }

    const errorMessage = chunk.error?.message || chunk.message
    if (errorMessage) {
      failure = errorMessage
      return
    }

    const choice = chunk.choices?.[0]
    const piece = choice?.delta?.content ?? choice?.message?.content
    if (typeof piece === 'string' && piece.length > 0) {
      content += piece
      onProgress?.(content.length)
    }
  }

  while (!finished && !failure) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let lineBreak = buffer.indexOf('\n')
    while (lineBreak >= 0) {
      let line = buffer.slice(0, lineBreak)
      buffer = buffer.slice(lineBreak + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.startsWith('data:')) {
        handleData(line.slice(5).trimStart())
      }
      if (finished || failure) break
      lineBreak = buffer.indexOf('\n')
    }
  }

  if (!finished && !failure && buffer.startsWith('data:')) {
    handleData(buffer.slice(5).trimStart())
  }
  if (failure) {
    throw new IntelligenceRequestError(failure)
  }

  return content
}

async function withRequest<T>(
  url: string,
  payload: ChatCompletionPayload,
  connection: ResolvedConnection,
  parentSignal: AbortSignal,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const handleParentAbort = () => controller.abort()
  const timeout = window.setTimeout(() => {
    controller.abort(new DOMException('Request timed out', 'AbortError'))
  }, timeoutMs)

  parentSignal.addEventListener('abort', handleParentAbort, { once: true })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
        Accept: 'text/event-stream, application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return await consume(response)
  } catch (error) {
    throw new Error(
      toRequestErrorMessage(error, connection.apiKey, connection.kind),
      { cause: error }
    )
  } finally {
    window.clearTimeout(timeout)
    parentSignal.removeEventListener('abort', handleParentAbort)
  }
}

async function requestJson(
  url: string,
  payload: ChatCompletionPayload,
  connection: ResolvedConnection,
  parentSignal: AbortSignal,
  timeoutMs: number
): Promise<ChatCompletionResponse> {
  return withRequest(
    url,
    payload,
    connection,
    parentSignal,
    timeoutMs,
    async (response) => {
      const data = (await response
        .json()
        .catch(() => ({}))) as ChatCompletionResponse

      if (!response.ok) {
        const message =
          data.error?.message || data.message || `HTTP ${response.status}`
        throw new IntelligenceRequestError(
          redactSecret(message, connection.apiKey),
          response.status
        )
      }

      return data
    }
  )
}

async function requestEventStream(
  url: string,
  payload: ChatCompletionPayload,
  connection: ResolvedConnection,
  parentSignal: AbortSignal,
  timeoutMs: number,
  onProgress?: (receivedChars: number) => void
): Promise<string> {
  return withRequest(
    url,
    payload,
    connection,
    parentSignal,
    timeoutMs,
    async (response) => {
      if (!response.ok) {
        const data = (await response
          .json()
          .catch(() => ({}))) as ChatCompletionResponse
        const message =
          data.error?.message || data.message || `HTTP ${response.status}`
        throw new IntelligenceRequestError(
          redactSecret(message, connection.apiKey),
          response.status
        )
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!response.body || contentType.includes('application/json')) {
        const data = (await response
          .json()
          .catch(() => ({}))) as ChatCompletionResponse
        const content = data.choices?.[0]?.message?.content
        if (typeof content !== 'string' || content.trim() === '') {
          throw new IntelligenceRequestError(
            'The model returned an empty response.'
          )
        }
        return content
      }

      return consumeEventStream(response.body, onProgress)
    }
  )
}

export async function resolveConnection(
  connection: ConnectionConfig
): Promise<ResolvedConnection> {
  if (connection.kind === 'custom') {
    return {
      baseUrl: normalizeOpenAIBaseUrl(connection.baseUrl),
      apiKey: connection.apiKey,
      model: connection.model,
      kind: 'custom',
    }
  }

  const result = await fetchTokenKey(connection.keyId)
  if (!result.success || !result.data?.key) {
    throw new Error('Failed to load the selected API key.')
  }

  return {
    baseUrl: `${window.location.origin}/v1`,
    apiKey: `sk-${result.data.key}`,
    model: connection.model,
    kind: 'platform',
  }
}

export async function sendModelRequest(
  connection: ResolvedConnection,
  payload: ChatCompletionPayload,
  signal: AbortSignal,
  timeoutMs: number
): Promise<string> {
  const response = await requestJson(
    buildChatCompletionsUrl(connection.baseUrl),
    payload,
    connection,
    signal,
    timeoutMs
  )
  const content = response.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new IntelligenceRequestError('The model returned an empty response.')
  }
  return content
}

export async function sendStreamingModelRequest(
  connection: ResolvedConnection,
  payload: ChatCompletionPayload,
  signal: AbortSignal,
  timeoutMs: number,
  onProgress?: (receivedChars: number) => void
): Promise<string> {
  const content = await requestEventStream(
    buildChatCompletionsUrl(connection.baseUrl),
    { ...payload, stream: true },
    connection,
    signal,
    timeoutMs,
    onProgress
  )
  if (content.trim() === '') {
    throw new IntelligenceRequestError('The model returned an empty response.')
  }
  return content
}

export async function loadPlatformApiKeys(): Promise<ApiKey[]> {
  const result = await getApiKeys({ p: 1, size: 100 })
  if (!result.success) {
    throw new Error(result.message || 'Failed to load API keys.')
  }
  return result.data?.items ?? []
}

export async function loadModelsForGroup(group: string): Promise<string[]> {
  const response = await api.get('/api/user/models', {
    params: { group },
  })
  const models = response.data?.data
  return Array.isArray(models) ? models : []
}

export function filterModelsForKey(models: string[], key: ApiKey): string[] {
  if (!key.model_limits_enabled) return models

  const allowed = new Set(
    (key.model_limits || '')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean)
  )
  return models.filter((model) => allowed.has(model))
}
