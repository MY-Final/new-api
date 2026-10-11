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
import { nanoid } from 'nanoid'

import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
import type {
  Message,
  MessageVersion,
  ChatCompletionMessage,
  ContentPart,
  MessageContent,
} from '../../types'

/**
 * Create a new message version
 */
export function createMessageVersion(content: MessageContent): MessageVersion {
  return {
    id: nanoid(),
    content,
  }
}

/**
 * Get current version from message (always returns the first version)
 */
export function getCurrentVersion(message: Message): MessageVersion {
  return message.versions[0] || { id: 'default', content: '' }
}

/**
 * Get displayable text from the current message version.
 */
export function getMessageContent(message: Message): string {
  return getTextContent(getCurrentVersion(message).content)
}

/**
 * Get the images attached to the current message version.
 */
export function getMessageImages(message: Message): string[] {
  return getContentImages(getCurrentVersion(message).content)
}

/**
 * Check whether a message has content to show or send. A user message with
 * only images attached counts as content.
 */
export function hasMessageContent(message: Message): boolean {
  const content = getCurrentVersion(message).content

  return (
    getTextContent(content).trim() !== '' || getContentImages(content).length > 0
  )
}

/**
 * Update current version content in message
 */
export function updateCurrentVersionContent(
  message: Message,
  content: MessageContent
): Message {
  const currentVersion = getCurrentVersion(message)
  return {
    ...message,
    versions: [{ ...currentVersion, content }],
  }
}

/**
 * Create a user message
 */
export function createUserMessage(
  content: MessageContent,
  createdAt: number = Date.now()
): Message {
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.USER,
    versions: [createMessageVersion(content)],
    createdAt,
  }
}

/**
 * Create a loading assistant message
 */
export function createLoadingAssistantMessage(
  startedAt: number = Date.now()
): Message {
  return {
    key: nanoid(),
    from: MESSAGE_ROLES.ASSISTANT,
    versions: [createMessageVersion('')],
    createdAt: startedAt,
    startedAt,
    reasoning: undefined,
    isReasoningComplete: false,
    isContentComplete: false,
    isReasoningStreaming: false,
    status: MESSAGE_STATUS.LOADING,
  }
}

/**
 * Build message content with optional images
 */
export function buildMessageContent(
  text: string,
  imageUrls: string[] = []
): MessageContent {
  const validImages = imageUrls.filter((url) => url.trim() !== '')

  if (validImages.length === 0) {
    return text
  }

  const parts: ContentPart[] = [
    {
      type: 'text',
      text: text || '',
    },
    ...validImages.map((url) => ({
      type: 'image_url' as const,
      image_url: { url: url.trim() },
    })),
  ]

  return parts
}

/**
 * Extract text content from message content
 */
export function getTextContent(content: MessageContent): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const textPart = content.find((part) => part.type === 'text')
    return textPart?.text || ''
  }

  return ''
}

/**
 * Extract attached image URLs from message content
 */
export function getContentImages(content: MessageContent): string[] {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap((part) =>
    part.type === 'image_url' && part.image_url?.url
      ? [part.image_url.url]
      : []
  )
}

/**
 * Replace the text of a message while keeping its attached images, so editing
 * an image message only rewrites the text part.
 */
export function replaceMessageText(
  content: MessageContent,
  text: string
): MessageContent {
  if (!Array.isArray(content)) {
    return text
  }

  const images = content.filter((part) => part.type === 'image_url')
  if (images.length === 0) {
    return text
  }

  return [{ type: 'text', text }, ...images]
}

/**
 * Format message for API request
 */
export function formatMessageForAPI(message: Message): ChatCompletionMessage {
  const currentVersion = getCurrentVersion(message)
  return {
    role: message.from,
    content: currentVersion.content,
  }
}

/**
 * Check if message is valid for API request
 * Excludes loading/streaming assistant messages and empty content
 */
export function isValidMessage(message: Message): boolean {
  if (!message || !message.from || !message.versions.length) return false

  // Exclude empty assistant messages (loading/streaming placeholders)
  if (message.from === MESSAGE_ROLES.ASSISTANT && !hasMessageContent(message)) {
    return false
  }

  return true
}
