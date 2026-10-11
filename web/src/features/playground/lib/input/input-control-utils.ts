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
import type { GroupOption, MessageContent, ModelOption } from '../../types'
import { buildMessageContent } from '../message/message-utils'

type InputControlStateOptions = {
  disabled?: boolean
  groups: GroupOption[]
  hasAttachments?: boolean
  hasStopHandler: boolean
  isGenerating?: boolean
  isModelLoading?: boolean
  models: ModelOption[]
  text: string
}

type InputControlState = {
  canSubmit: boolean
  isSelectorDisabled: boolean
  shouldShowStop: boolean
}

type SubmittableInputAttachment = {
  mediaType?: string
  url?: string
}

type SubmittableInputMessage = {
  text?: string | null
  files?: SubmittableInputAttachment[]
}

/** Attached images only: the playground sends text and images. */
export function getImageAttachmentUrls(
  files: SubmittableInputAttachment[] | undefined
): string[] {
  return (files ?? []).flatMap((file) =>
    file.mediaType?.startsWith('image/') && file.url ? [file.url] : []
  )
}

/**
 * Build the content to send from the composer state. An image-only message is
 * submittable too, so `null` means "nothing to send".
 */
export function getSubmittableInputContent(
  message: SubmittableInputMessage,
  disabled?: boolean
): MessageContent | null {
  if (disabled) {
    return null
  }

  const text = message.text ?? ''
  const imageUrls = getImageAttachmentUrls(message.files)

  if (!text.trim() && imageUrls.length === 0) {
    return null
  }

  return buildMessageContent(text, imageUrls)
}

export function getInputControlState({
  disabled,
  groups,
  hasAttachments,
  hasStopHandler,
  isGenerating,
  isModelLoading,
  models,
  text,
}: InputControlStateOptions): InputControlState {
  const hasModels = models.length > 0

  return {
    canSubmit:
      !disabled &&
      hasModels &&
      (text.trim().length > 0 || Boolean(hasAttachments)),
    isSelectorDisabled: disabled || isModelLoading || groups.length === 0,
    shouldShowStop: Boolean(isGenerating && hasStopHandler),
  }
}
