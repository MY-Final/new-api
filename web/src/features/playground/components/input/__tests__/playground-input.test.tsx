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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { applyMessageEdit } from '../../../lib/message/conversation-message-utils'
import {
  buildMessageContent,
  createUserMessage,
  getMessageImages,
} from '../../../lib/message/message-utils'
import { buildChatCompletionPayload } from '../../../lib/streaming/payload-builder'
import type {
  MessageContent,
  ParameterEnabled,
  PlaygroundConfig,
} from '../../../types'
import { PlaygroundInput } from '../playground-input'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

const config: PlaygroundConfig = {
  model: 'gpt-4o',
  group: 'default',
  stream: true,
  temperature: 1,
  top_p: 1,
  max_tokens: 1024,
  frequency_penalty: 0,
  presence_penalty: 0,
  seed: 0,
}

const parameterEnabled: ParameterEnabled = {
  temperature: false,
  top_p: false,
  max_tokens: false,
  frequency_penalty: false,
  presence_penalty: false,
  seed: false,
}

function imageFile(name = 'photo.png') {
  return new File([new Uint8Array([137, 80, 78, 71])], name, {
    type: 'image/png',
  })
}

// The composer renders the mobile and desktop submit buttons side by side; CSS
// hides one of them, which jsdom does not apply.
function sendButtons() {
  return screen.getAllByRole('button', { name: /send/i })
}

function sendButton(): HTMLElement {
  const [button] = sendButtons()
  if (!button) {
    throw new Error('Send button not found')
  }
  return button
}

function renderInput(onSubmit: (content: MessageContent) => void) {
  render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <PlaygroundInput
          config={config}
          groupValue={config.group ?? ''}
          groups={[{ label: 'default', value: 'default', ratio: 1 }]}
          modelValue={config.model}
          models={[{ label: 'gpt-4o', value: 'gpt-4o' }]}
          onClearMessages={() => undefined}
          onConfigChange={() => undefined}
          onGroupChange={() => undefined}
          onModelChange={() => undefined}
          onParameterEnabledChange={() => undefined}
          onSubmit={onSubmit}
          parameterEnabled={parameterEnabled}
        />
      </TooltipProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('playground composer attachments', () => {
  it('sends text together with the attached image', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderInput(onSubmit)

    await user.upload(screen.getByLabelText('Upload files'), imageFile())
    await user.type(screen.getByRole('textbox'), 'describe this')
    await user.click(sendButton())

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const content = onSubmit.mock.calls[0]?.[0] as Exclude<
      MessageContent,
      string
    >
    expect(content[0]).toEqual({ type: 'text', text: 'describe this' })
    expect(content[1]?.type).toBe('image_url')
    expect(content[1]?.image_url?.url).toMatch(/^data:image\/png;base64,/)
  })

  it('sends an image without any text', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderInput(onSubmit)

    await user.upload(screen.getByLabelText('Upload files'), imageFile())
    await user.click(sendButton())

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const content = onSubmit.mock.calls[0]?.[0] as Exclude<
      MessageContent,
      string
    >
    expect(content).toHaveLength(2)
    expect(content[1]?.type).toBe('image_url')
  })

  it('leaves non-image files unattached', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderInput(onSubmit)

    await user.upload(
      screen.getByLabelText('Upload files'),
      new File(['notes'], 'notes.txt', { type: 'text/plain' })
    )

    // Nothing was attached, so there is nothing to send.
    for (const button of sendButtons()) {
      expect(button).toBeDisabled()
    }
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps the attached image when the text is edited and re-sent', () => {
    const message = createUserMessage(
      buildMessageContent('what is this', ['data:image/png;base64,AAAA'])
    )
    const edit = applyMessageEdit(
      [message],
      message.key,
      'what is this really',
      true
    )
    const edited = edit?.messages[0]

    expect(edited && getMessageImages(edited)).toEqual([
      'data:image/png;base64,AAAA',
    ])
    expect(
      buildChatCompletionPayload(edit?.messages ?? [], config, parameterEnabled)
        .messages[0]?.content
    ).toEqual([
      { type: 'text', text: 'what is this really' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })

  it('keeps text and image parts in the chat completion payload', () => {
    const message = createUserMessage(
      buildMessageContent('what is this', ['data:image/png;base64,AAAA'])
    )
    const payload = buildChatCompletionPayload(
      [message],
      config,
      parameterEnabled
    )

    expect(payload.messages[0]?.content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })
})
