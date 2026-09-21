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
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  resolveConnection,
  sendModelRequest,
  sendStreamingModelRequest,
  type ResolvedConnection,
} from '../api'
import {
  DRAWING_STYLES,
  KNOWLEDGE_PROMPT,
  LOGIC_PROMPT,
  MAX_OUTPUT_TOKENS,
  TASK_TIMEOUT_MS,
  buildDrawingPrompt,
} from '../constants'
import {
  evaluateKnowledge,
  evaluateLogic,
  extractCompleteHtml,
  renderDrawingScreenshot,
  validateDrawingHtml,
} from '../lib/evaluation'
import { isTerminalStatus } from '../lib/task-status'
import type {
  ConnectionConfig,
  DrawingEvaluation,
  DrawingStyle,
  DrawingValidationResult,
  KnowledgeResult,
  LogicResult,
  RunSnapshot,
  TaskId,
  TaskResult,
} from '../types'

function emptyTask<T>(): TaskResult<T> {
  return {
    status: 'queued',
    rawResponse: '',
    durationMs: 0,
  }
}

function skippedTask<T>(): TaskResult<T> {
  return {
    status: 'skipped',
    rawResponse: '',
    durationMs: 0,
  }
}

function runningTask<T>(): TaskResult<T> {
  return {
    status: 'running',
    rawResponse: '',
    durationMs: 0,
  }
}

function taskForSelection<T>(
  tasks: TaskId[],
  id: TaskId,
  run: () => TaskResult<T>,
  previous?: TaskResult<T>
): TaskResult<T> {
  if (tasks.includes(id)) return run()
  if (previous && isTerminalStatus(previous.status)) return previous
  return skippedTask<T>()
}

function createEmptySnapshot(): RunSnapshot {
  return {
    runNumber: 0,
    styleName: '',
    tasks: [],
    startedAt: 0,
    logic: emptyTask<LogicResult>(),
    drawing: emptyTask<DrawingEvaluation>(),
    knowledge: emptyTask<KnowledgeResult>(),
  }
}

function createRunningSnapshot(
  runNumber: number,
  styleName: string,
  tasks: TaskId[],
  previous: RunSnapshot
): RunSnapshot {
  const startedAt = Date.now()

  return {
    runNumber,
    styleName,
    tasks,
    startedAt,
    logic: taskForSelection(
      tasks,
      'logic',
      runningTask<LogicResult>,
      previous.logic
    ),
    drawing: taskForSelection(
      tasks,
      'drawing',
      runningTask<DrawingEvaluation>,
      previous.drawing
    ),
    knowledge: taskForSelection(
      tasks,
      'knowledge',
      runningTask<KnowledgeResult>,
      previous.knowledge
    ),
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'The model request failed.'
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

async function executeLogicTask(
  connection: ResolvedConnection,
  signal: AbortSignal
): Promise<TaskResult<LogicResult>> {
  const startedAt = Date.now()

  try {
    const rawResponse = await sendModelRequest(
      connection,
      {
        model: connection.model,
        messages: [{ role: 'user', content: LOGIC_PROMPT }],
        stream: false,
        max_tokens: MAX_OUTPUT_TOKENS.logic,
      },
      signal,
      TASK_TIMEOUT_MS.logic
    )
    const evaluation = evaluateLogic(rawResponse)

    if (!evaluation) {
      return {
        status: 'failed',
        rawResponse,
        durationMs: elapsedSince(startedAt),
        error: 'The response does not match the required JSON format.',
      }
    }

    return {
      status: evaluation.passed ? 'passed' : 'failed',
      data: evaluation,
      rawResponse,
      durationMs: elapsedSince(startedAt),
    }
  } catch (error) {
    return {
      status: 'technical_error',
      rawResponse: '',
      durationMs: elapsedSince(startedAt),
      error: getErrorMessage(error),
    }
  }
}

async function executeKnowledgeTask(
  connection: ResolvedConnection,
  signal: AbortSignal
): Promise<TaskResult<KnowledgeResult>> {
  const startedAt = Date.now()

  try {
    const rawResponse = await sendModelRequest(
      connection,
      {
        model: connection.model,
        messages: [{ role: 'user', content: KNOWLEDGE_PROMPT }],
        stream: false,
        max_tokens: MAX_OUTPUT_TOKENS.knowledge,
      },
      signal,
      TASK_TIMEOUT_MS.knowledge
    )
    const evaluation = evaluateKnowledge(rawResponse)

    if (!evaluation) {
      return {
        status: 'failed',
        rawResponse,
        durationMs: elapsedSince(startedAt),
        error: 'The response does not match the required JSON format.',
      }
    }

    return {
      status: evaluation.passed ? 'passed' : 'failed',
      data: evaluation,
      rawResponse,
      durationMs: elapsedSince(startedAt),
    }
  } catch (error) {
    return {
      status: 'technical_error',
      rawResponse: '',
      durationMs: elapsedSince(startedAt),
      error: getErrorMessage(error),
    }
  }
}

async function executeDrawingTask(
  connection: ResolvedConnection,
  signal: AbortSignal,
  styleName: string,
  styleDescription: string,
  onProgress?: (receivedChars: number) => void
): Promise<TaskResult<DrawingEvaluation>> {
  const startedAt = Date.now()
  let drawingRawResponse = ''
  let html = ''
  let validation: DrawingValidationResult | null = null
  let screenshot = ''
  let lastProgressAt = 0

  const reportProgress = (receivedChars: number) => {
    const now = Date.now()
    if (now - lastProgressAt < 1000) return
    lastProgressAt = now
    onProgress?.(receivedChars)
  }

  try {
    drawingRawResponse = await sendStreamingModelRequest(
      connection,
      {
        model: connection.model,
        messages: [
          {
            role: 'user',
            content: buildDrawingPrompt(styleName, styleDescription),
          },
        ],
        stream: true,
        max_tokens: MAX_OUTPUT_TOKENS.drawing,
      },
      signal,
      TASK_TIMEOUT_MS.drawing,
      reportProgress
    )
    const extractedHtml = extractCompleteHtml(drawingRawResponse)
    if (!extractedHtml) {
      return {
        status: 'failed',
        rawResponse: drawingRawResponse,
        durationMs: elapsedSince(startedAt),
        error: 'The output is not a complete HTML document.',
      }
    }
    html = extractedHtml

    const htmlValidation = validateDrawingHtml(html)
    if (!htmlValidation.valid) {
      return {
        status: 'failed',
        rawResponse: drawingRawResponse,
        durationMs: elapsedSince(startedAt),
        error: htmlValidation.issues.join(' '),
      }
    }
    validation = htmlValidation

    // The static screenshot is a convenience preview only; a rendering failure
    // must not fail a drawing that already produced playable HTML.
    try {
      screenshot = await renderDrawingScreenshot(htmlValidation.svg)
    } catch {
      screenshot = ''
    }

    const evaluation: DrawingEvaluation = {
      passed: true,
      html,
      svg: htmlValidation.svg,
      screenshot,
      validation: htmlValidation,
    }

    return {
      status: 'passed',
      data: evaluation,
      rawResponse: drawingRawResponse,
      durationMs: elapsedSince(startedAt),
    }
  } catch (error) {
    return {
      status: 'technical_error',
      data: validation
        ? {
            passed: false,
            html,
            svg: validation.svg,
            screenshot,
            validation,
          }
        : undefined,
      rawResponse: drawingRawResponse,
      durationMs: elapsedSince(startedAt),
      error: getErrorMessage(error),
    }
  }
}

function createTechnicalSnapshot(
  runNumber: number,
  styleName: string,
  tasks: TaskId[],
  message: string,
  previous: RunSnapshot
): RunSnapshot {
  const failed = <T>(): TaskResult<T> => ({
    status: 'technical_error',
    rawResponse: '',
    durationMs: 0,
    error: message,
  })
  const failedLogic: TaskResult<LogicResult> = failed()
  const failedDrawing: TaskResult<DrawingEvaluation> = failed()
  const failedKnowledge: TaskResult<KnowledgeResult> = failed()

  return {
    runNumber,
    styleName,
    tasks,
    startedAt: Date.now(),
    completedAt: Date.now(),
    logic: taskForSelection(tasks, 'logic', () => failedLogic, previous.logic),
    drawing: taskForSelection(
      tasks,
      'drawing',
      () => failedDrawing,
      previous.drawing
    ),
    knowledge: taskForSelection(
      tasks,
      'knowledge',
      () => failedKnowledge,
      previous.knowledge
    ),
  }
}

export function useIntelligenceRun() {
  const [snapshot, setSnapshot] = useState<RunSnapshot>(createEmptySnapshot)
  const snapshotRef = useRef(snapshot)
  const abortControllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const cancel = useCallback(() => {
    generationRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }, [])

  const cancelRun = useCallback(() => {
    cancel()
    setSnapshot((current) => {
      if (current.runNumber === 0) return current
      const canceledTask = <T>(task: TaskResult<T>): TaskResult<T> => {
        if (task.status !== 'running' && task.status !== 'queued') return task
        return {
          ...task,
          status: 'technical_error',
          durationMs: elapsedSince(current.startedAt),
          error: 'The run was canceled.',
        }
      }
      return {
        ...current,
        completedAt: Date.now(),
        logic: canceledTask(current.logic),
        drawing: canceledTask(current.drawing),
        knowledge: canceledTask(current.knowledge),
      }
    })
  }, [cancel])

  const run = useCallback(
    async (
      connection: ConnectionConfig,
      runNumber: number,
      tasks: TaskId[],
      customStyle?: DrawingStyle
    ) => {
      cancel()
      const generation = generationRef.current
      const controller = new AbortController()
      abortControllerRef.current = controller
      const style =
        customStyle ?? DRAWING_STYLES[(runNumber - 1) % DRAWING_STYLES.length]
      const previous = snapshotRef.current
      const runningSnapshot = createRunningSnapshot(
        runNumber,
        style.name,
        tasks,
        previous
      )
      setSnapshot(runningSnapshot)

      let resolvedConnection: ResolvedConnection
      try {
        resolvedConnection = await resolveConnection(connection)
      } catch (error) {
        if (generation !== generationRef.current) return
        setSnapshot(
          createTechnicalSnapshot(
            runNumber,
            style.name,
            tasks,
            getErrorMessage(error),
            previous
          )
        )
        return
      }

      const [logic, drawing, knowledge] = await Promise.all([
        tasks.includes('logic')
          ? executeLogicTask(resolvedConnection, controller.signal)
          : Promise.resolve(runningSnapshot.logic),
        tasks.includes('drawing')
          ? executeDrawingTask(
              resolvedConnection,
              controller.signal,
              style.name,
              style.description,
              (receivedChars) => {
                if (generation !== generationRef.current) return
                setSnapshot((current) =>
                  current.runNumber === runNumber &&
                  current.drawing.status === 'running'
                    ? {
                        ...current,
                        drawing: {
                          ...current.drawing,
                          progress: receivedChars,
                        },
                      }
                    : current
                )
              }
            )
          : Promise.resolve(runningSnapshot.drawing),
        tasks.includes('knowledge')
          ? executeKnowledgeTask(resolvedConnection, controller.signal)
          : Promise.resolve(runningSnapshot.knowledge),
      ])

      if (generation !== generationRef.current) return

      setSnapshot({
        ...runningSnapshot,
        completedAt: Date.now(),
        logic,
        drawing,
        knowledge,
      })
      abortControllerRef.current = null
    },
    [cancel]
  )

  useEffect(() => () => cancel(), [cancel])

  return {
    snapshot,
    isRunning:
      snapshot.logic.status === 'running' ||
      snapshot.drawing.status === 'running' ||
      snapshot.knowledge.status === 'running',
    run,
    cancelRun,
  }
}
