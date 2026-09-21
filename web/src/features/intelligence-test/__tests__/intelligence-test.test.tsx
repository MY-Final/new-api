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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { IntelligenceTest } from '..'

const mocks = vi.hoisted(() => ({
  getApiKeys: vi.fn(),
  fetchTokenKey: vi.fn(),
  renderDrawingScreenshot: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/features/keys/api', () => ({
  getApiKeys: mocks.getApiKeys,
  fetchTokenKey: mocks.fetchTokenKey,
}))

vi.mock('../lib/evaluation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/evaluation')>()
  return {
    ...actual,
    renderDrawingScreenshot: mocks.renderDrawingScreenshot,
  }
})

const DRAWING_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
@keyframes pedal-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.pedal { animation: pedal-spin 1s linear infinite; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<circle class="pedal" cx="300" cy="500" r="40" fill="#333333" />
</svg>
</body>
</html>`

const LOGIC_JSON = JSON.stringify({
  answer: 21,
  round: 9,
  star: 12,
  explanation: 'Nine round and twelve star cover every bad assignment.',
})

const KNOWLEDGE_JSON = JSON.stringify({
  answers: [
    {
      id: 'q1',
      answer: ['Pierre Agostini', 'Ferenc Krausz', "Anne L'Huillier"],
    },
    { id: 'q2', answer: ['2023-10-02'] },
    { id: 'q3', answer: ['Jon Fosse'] },
  ],
})

const clients: QueryClient[] = []

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: (): string => 'application/json' },
    json: async () => ({ choices: [{ message: { content } }] }),
  }
}

function logicContentResponse(content: string) {
  return okResponse(`\`\`\`json\n${content}\n\`\`\``)
}

function promptOf(init: RequestInit): string {
  const body = JSON.parse(String(init.body)) as {
    messages: Array<{ content: unknown }>
  }
  return JSON.stringify(body.messages[0]?.content ?? '')
}

function authHeaderOf(init: RequestInit): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.Authorization
}

function installFetchMock(options?: { logic?: unknown }) {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const prompt = promptOf(init)
    if (prompt.includes('袋中有三种口味')) {
      if (options?.logic) return options.logic
      return logicContentResponse(LOGIC_JSON)
    }
    if (prompt.includes('鹈鹕骑自行车')) return okResponse(DRAWING_HTML)
    if (prompt.includes('知识抽查')) return okResponse(KNOWLEDGE_JSON)
    throw new Error(`Unexpected request: ${prompt.slice(0, 80)}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <IntelligenceTest />
    </QueryClientProvider>
  )
}

async function selectDefaultPlatformConnection() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Choose a test model' }))
  await user.click(
    await screen.findByRole('button', { name: 'Use this model' })
  )
  return user
}

beforeEach(() => {
  mocks.getApiKeys.mockResolvedValue({
    success: true,
    data: {
      items: [
        { id: 5, name: 'Primary Key', status: 1, group: 'default' },
        { id: 6, name: 'Backup Key', status: 1, group: 'vip' },
      ],
    },
  })
  mocks.fetchTokenKey.mockResolvedValue({
    success: true,
    data: { key: 'platform-token' },
  })
  mocks.renderDrawingScreenshot.mockResolvedValue('data:image/png;base64,AAAA')
})

afterEach(() => {
  for (const client of clients) client.clear()
  clients.length = 0
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('Intelligence test page', () => {
  test('lets the user pick a platform key and model and runs the three tasks', async () => {
    const fetchMock = installFetchMock()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    renderPage()

    await selectDefaultPlatformConnection()
    expect(screen.getByText('Primary Key · gpt-test')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )

    expect(await screen.findAllByText('21')).toHaveLength(2)
    expect(await screen.findByText('Round 9 / Star 12')).toBeInTheDocument()
    expect(await screen.findByText('2023-10-02')).toBeInTheDocument()
    expect(await screen.findByText('Generated')).toBeInTheDocument()
    expect(screen.getByText('3/3 completed')).toBeInTheDocument()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const prompts = fetchMock.mock.calls.map((call) => promptOf(call[1]))
    expect(prompts.some((prompt) => prompt.includes('视觉作品评审'))).toBe(
      false
    )
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${window.location.origin}/v1/chat/completions`
    )
    expect(authHeaderOf(fetchMock.mock.calls[0][1])).toBe(
      'Bearer sk-platform-token'
    )

    const iframe = screen.getByTitle('Drawing animation preview')
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe.getAttribute('srcdoc')).toContain('pedal-spin')

    await user.click(screen.getByRole('button', { name: 'Replay' }))
    await waitFor(() =>
      expect(screen.getByTitle('Drawing animation preview')).not.toBe(iframe)
    )
  })

  test('switches to another key and loads the models of its group', async () => {
    const fetchMock = installFetchMock()
    vi.spyOn(api, 'get').mockImplementation(async (_url, config) => {
      const group = (config as { params?: { group?: string } })?.params?.group
      return {
        data: {
          success: true,
          data: group === 'vip' ? ['gpt-vip'] : ['gpt-test'],
        },
      } as never
    })

    renderPage()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Choose a test model' })
    )
    await user.click(
      await screen.findByRole('combobox', { name: 'Select an API key' })
    )
    await user.click(await screen.findByRole('option', { name: /Backup Key/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Use this model' })
    )

    expect(screen.getByText('Backup Key · gpt-vip')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[0][1].body).toContain('gpt-vip')
  })

  test('does not run when no enabled platform key exists', async () => {
    const fetchMock = installFetchMock()
    mocks.getApiKeys.mockResolvedValue({
      success: true,
      data: {
        items: [{ id: 5, name: 'Disabled', status: 2, group: 'default' }],
      },
    })

    renderPage()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Choose a test model' })
    )
    expect(await screen.findByText('No enabled API keys')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Use this model' })
    ).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('keeps the other cards completed when one task fails technically', async () => {
    installFetchMock({
      logic: {
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'upstream exploded' } }),
      },
    })
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    renderPage()
    await selectDefaultPlatformConnection()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )

    expect(await screen.findByText('2023-10-02')).toBeInTheDocument()
    expect(await screen.findByText('Generated')).toBeInTheDocument()
    expect(await screen.findByText('Technical failure')).toBeInTheDocument()
    expect(screen.queryByText('Round 9 / Star 12')).not.toBeInTheDocument()
    expect(screen.queryByText('21')).not.toBeInTheDocument()
  })

  test('keeps the animation when the static screenshot cannot be rendered', async () => {
    installFetchMock()
    mocks.renderDrawingScreenshot.mockRejectedValue(
      new Error('Unable to render the SVG drawing.')
    )
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    renderPage()
    await selectDefaultPlatformConnection()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )

    expect(await screen.findByText('Generated')).toBeInTheDocument()
    expect(screen.getByText('Loop detected')).toBeInTheDocument()
    expect(screen.getByTitle('Drawing animation preview')).toBeInTheDocument()
    expect(
      screen.queryByText('Unable to render the SVG drawing.')
    ).not.toBeInTheDocument()
  })

  test('streams the animation HTML from the model', async () => {
    const encoder = new TextEncoder()
    const drawingChunks = DRAWING_HTML.match(/[\s\S]{1,120}/g) ?? []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const prompt = promptOf(init)
      if (prompt.includes('袋中有三种口味')) {
        return logicContentResponse(LOGIC_JSON)
      }
      if (prompt.includes('知识抽查')) return okResponse(KNOWLEDGE_JSON)
      if (prompt.includes('鹈鹕骑自行车')) {
        return {
          ok: true,
          status: 200,
          headers: { get: (): string => 'text/event-stream' },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of drawingChunks) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`
                  )
                )
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              controller.close()
            },
          }),
        }
      }
      throw new Error(`Unexpected request: ${prompt.slice(0, 80)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    renderPage()
    await selectDefaultPlatformConnection()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )

    expect(await screen.findByText('Generated')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(
      screen.getByTitle('Drawing animation preview').getAttribute('srcdoc')
    ).toContain('pedal-spin')
  })

  test('runs only the selected tasks and skips the rest', async () => {
    const fetchMock = installFetchMock()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    renderPage()
    await selectDefaultPlatformConnection()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Drawing and animation' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Knowledge freshness' })
    )
    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )

    expect(await screen.findAllByText('21')).toHaveLength(2)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(promptOf(fetchMock.mock.calls[0][1])).toContain('袋中有三种口味')
    expect(
      screen.getAllByText('This task was not selected for this run.')
    ).toHaveLength(2)
    expect(screen.getByText('1/1 completed')).toBeInTheDocument()
  })

  test('lets the user describe a custom pelican style before running', async () => {
    const fetchMock = installFetchMock()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    renderPage()
    await selectDefaultPlatformConnection()

    const user = userEvent.setup()
    const drawingToggle = screen.getByRole('button', {
      name: 'Drawing and animation',
    })
    await user.click(drawingToggle)
    await user.click(drawingToggle)

    expect(
      await screen.findByRole('button', { name: 'Use preset styles' })
    ).toBeInTheDocument()
    await user.type(
      await screen.findByLabelText('Style description'),
      '赛博朋克鹈鹕，霓虹翅膀'
    )
    await user.click(screen.getByRole('button', { name: 'Use this style' }))

    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    const drawingCall = fetchMock.mock.calls.find((call) =>
      promptOf(call[1]).includes('鹈鹕骑自行车')
    )
    if (!drawingCall) throw new Error('drawing request was not sent')
    expect(promptOf(drawingCall[1])).toContain('赛博朋克鹈鹕，霓虹翅膀')
    expect(screen.getByText('赛博朋克鹈鹕，霓虹翅膀')).toBeInTheDocument()
  })

  test('exposes the pressed task state and disables the run button when empty', async () => {
    renderPage()

    const user = userEvent.setup()
    const logicToggle = screen.getByRole('button', {
      name: 'Logical reasoning',
    })
    expect(logicToggle).toHaveAttribute('aria-pressed', 'true')

    await user.click(logicToggle)
    expect(logicToggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(
      screen.getByRole('button', { name: 'Drawing and animation' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Knowledge freshness' })
    )

    expect(screen.getByRole('button', { name: 'Start test' })).toBeDisabled()
  })

  test('keeps the page scrollable on small screens', () => {
    renderPage()

    const heading = screen.getByRole('heading', { name: 'Intelligence Test' })
    const pageRoot = heading.closest('div.mx-auto')

    expect(pageRoot).not.toBeNull()
    expect(pageRoot?.className).toContain('overflow-y-auto')
    expect(pageRoot?.className).toContain('min-h-0')
  })

  test('cancels a long-running test and marks unfinished cards', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    renderPage()
    await selectDefaultPlatformConnection()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )

    expect(
      await screen.findAllByText((content) => /^\d+(\.\d+)?s$/.test(content))
    ).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findAllByText('The run was canceled.')).toHaveLength(3)
    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument()
  })

  test('keeps a custom connection key only in memory', async () => {
    const fetchMock = installFetchMock()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: ['gpt-test'] },
    } as never)

    const view = renderPage()

    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Choose a test model' })
    )
    await user.click(
      await screen.findByRole('tab', { name: 'Custom endpoint' })
    )
    await user.type(screen.getByLabelText('Connection name'), 'My endpoint')
    await user.type(
      screen.getByLabelText('API address'),
      'https://api.example.com/v1'
    )
    await user.type(screen.getByLabelText('Model ID'), 'custom-model')
    await user.type(screen.getByLabelText('API Key'), 'sk-custom-secret')
    await user.click(screen.getByRole('button', { name: 'Save connection' }))

    expect(screen.getByText('My endpoint · custom-model')).toBeInTheDocument()
    expect(
      `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`
    ).not.toContain('sk-custom-secret')

    await user.click(
      screen.getByRole('button', { name: /Start test|Run again/ })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(authHeaderOf(fetchMock.mock.calls[0][1])).toBe(
      'Bearer sk-custom-secret'
    )

    view.unmount()

    expect(document.body.textContent).not.toContain('sk-custom-secret')
    renderPage()
    expect(
      screen.getByRole('button', { name: 'Choose a test model' })
    ).toBeInTheDocument()
  })
})
