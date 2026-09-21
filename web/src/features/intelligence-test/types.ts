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
export type TaskId = 'logic' | 'drawing' | 'knowledge'

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'technical_error'
  | 'skipped'

export type ConnectionKind = 'platform' | 'custom'

export interface PlatformConnection {
  kind: 'platform'
  keyId: number
  keyName: string
  group: string
  model: string
}

export interface CustomConnection {
  kind: 'custom'
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

export type ConnectionConfig = PlatformConnection | CustomConnection

export interface LogicResult {
  passed: boolean
  answer: number
  round: number
  star: number
  explanation: string
}

export interface KnowledgeAnswer {
  id: 'q1' | 'q2' | 'q3'
  expected: string[]
  answer: string[] | null
  passed: boolean
}

export interface KnowledgeResult {
  passed: boolean
  answers: KnowledgeAnswer[]
}

export interface DrawingValidationResult {
  valid: boolean
  issues: string[]
  html: string
  svg: string
  animationDeclared: boolean
  infiniteLoop: boolean
}

export interface DrawingStyle {
  name: string
  description: string
}

export interface DrawingEvaluation {
  passed: boolean
  html: string
  svg: string
  screenshot: string
  validation: DrawingValidationResult
}

export interface TaskResult<T> {
  status: TaskStatus
  data?: T
  rawResponse: string
  durationMs: number
  progress?: number
  error?: string
}

export interface RunSnapshot {
  runNumber: number
  styleName: string
  tasks: TaskId[]
  startedAt: number
  completedAt?: number
  logic: TaskResult<LogicResult>
  drawing: TaskResult<DrawingEvaluation>
  knowledge: TaskResult<KnowledgeResult>
}

export interface ChatTextPart {
  type: 'text'
  text: string
}

export interface ChatImagePart {
  type: 'image_url'
  image_url: {
    url: string
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<ChatTextPart | ChatImagePart>
}

export interface ChatCompletionPayload {
  model: string
  messages: ChatMessage[]
  stream: boolean
  max_tokens: number
}

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: {
    message?: string
  }
  message?: string
}
