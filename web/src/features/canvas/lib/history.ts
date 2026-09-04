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
export interface CanvasHistoryEntry {
  id: string
  image: string
  temporary?: boolean
  prompt: string
  model: string
  group: string
  size: string
  n: number
  createdAt: number
}

interface StoredCanvasHistoryEntry extends CanvasHistoryEntry {
  userId: number
}

export type HistoryStorageErrorReason = 'unavailable' | 'quota' | 'failed'

export class HistoryStorageError extends Error {
  readonly reason: HistoryStorageErrorReason

  constructor(reason: HistoryStorageErrorReason, cause?: unknown) {
    super(`Canvas history storage ${reason}`, { cause })
    this.name = 'HistoryStorageError'
    this.reason = reason
  }
}

export interface HistorySaveResult {
  success: boolean
  reason?: HistoryStorageErrorReason
}

export interface PersistedImageSource {
  image: string
  temporary: boolean
}

const HISTORY_DB_NAME = 'new-api-canvas-history'
const HISTORY_DB_VERSION = 1
const HISTORY_STORE_NAME = 'entries'
const HISTORY_INDEX_NAME = 'user-created-at'
const HISTORY_KEY = 'canvas_history'
const MIGRATION_PROMPT_KEY = 'canvas_history_migration_prompted'
const HISTORY_SYNC_CHANNEL = 'new-api-canvas-history-sync'
const HISTORY_SYNC_STORAGE_KEY = 'canvas_history_sync'
const MAX_ENTRIES = 50

type HistorySyncEvent = {
  kind: 'updated' | 'removed' | 'cleared'
  userId: number
  source: string
  timestamp: number
}

const historySyncSource = Math.random().toString(36).slice(2)
let historySyncPublisher: BroadcastChannel | null = null

function createHistoryBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(HISTORY_SYNC_CHANNEL)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isValidUserId(userId: number): boolean {
  return Number.isInteger(userId) && userId > 0
}

function parseHistoryEntry(
  value: unknown,
  expectedUserId?: number
): CanvasHistoryEntry | null {
  if (!isRecord(value)) return null
  const userId = value.userId
  const n = value.n
  const createdAt = value.createdAt
  if (
    expectedUserId !== undefined &&
    (typeof userId !== 'number' || userId !== expectedUserId)
  ) {
    return null
  }
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.image !== 'string' ||
    value.image.length === 0 ||
    typeof value.prompt !== 'string' ||
    typeof value.model !== 'string' ||
    typeof value.group !== 'string' ||
    typeof value.size !== 'string' ||
    typeof n !== 'number' ||
    !Number.isInteger(n) ||
    n < 1 ||
    typeof createdAt !== 'number' ||
    !Number.isFinite(createdAt)
  ) {
    return null
  }
  if (value.temporary !== undefined && typeof value.temporary !== 'boolean') {
    return null
  }
  return {
    id: value.id,
    image: value.image,
    temporary: value.temporary === true,
    prompt: value.prompt,
    model: value.model,
    group: value.group,
    size: value.size,
    n,
    createdAt,
  }
}

function getIndexedDB(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new HistoryStorageError('unavailable')
  }
  return indexedDB
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {
      once: true,
    })
    request.addEventListener('error', () => reject(request.error), {
      once: true,
    })
  })
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error), {
      once: true,
    })
    transaction.addEventListener('abort', () => reject(transaction.error), {
      once: true,
    })
  })
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  try {
    const request = getIndexedDB().open(HISTORY_DB_NAME, HISTORY_DB_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const database = request.result
      const store = database.objectStoreNames.contains(HISTORY_STORE_NAME)
        ? request.transaction?.objectStore(HISTORY_STORE_NAME)
        : database.createObjectStore(HISTORY_STORE_NAME, {
            keyPath: ['userId', 'id'],
          })
      if (store && !store.indexNames.contains(HISTORY_INDEX_NAME)) {
        store.createIndex(HISTORY_INDEX_NAME, ['userId', 'createdAt'])
      }
    })
    return new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result), {
        once: true,
      })
      request.addEventListener(
        'blocked',
        () => reject(new HistoryStorageError('unavailable')),
        { once: true }
      )
      request.addEventListener('error', () => reject(request.error), {
        once: true,
      })
    }).catch((cause) => {
      if (cause instanceof HistoryStorageError) throw cause
      throw new HistoryStorageError('failed', cause)
    })
  } catch (cause) {
    if (cause instanceof HistoryStorageError) throw cause
    throw new HistoryStorageError('failed', cause)
  }
}

function historyRange(userId: number): IDBKeyRange {
  return IDBKeyRange.bound(
    [userId, Number.MIN_SAFE_INTEGER],
    [userId, Number.MAX_SAFE_INTEGER]
  )
}

async function readUserEntries(
  database: IDBDatabase,
  userId: number
): Promise<{ entries: CanvasHistoryEntry[]; rawIds: IDBValidKey[] }> {
  const transaction = database.transaction(HISTORY_STORE_NAME, 'readonly')
  const transactionDone = transactionResult(transaction)
  const store = transaction.objectStore(HISTORY_STORE_NAME)
  const records = (await requestResult(
    store.index(HISTORY_INDEX_NAME).getAll(historyRange(userId))
  )) as unknown[]
  await transactionDone

  const entries: CanvasHistoryEntry[] = []
  const rawIds: IDBValidKey[] = []
  for (const record of records) {
    if (!isRecord(record) || record.userId !== userId) continue
    if (typeof record.id === 'string') rawIds.push([userId, record.id])
    const entry = parseHistoryEntry(record, userId)
    if (entry) entries.push(entry)
  }
  entries.sort((left, right) => right.createdAt - left.createdAt)
  return { entries, rawIds }
}

function isQuotaError(cause: unknown): boolean {
  return (
    isRecord(cause) &&
    (cause.name === 'QuotaExceededError' || cause.code === 22)
  )
}

async function writeUserEntries(
  database: IDBDatabase,
  userId: number,
  rawIds: IDBValidKey[],
  entries: CanvasHistoryEntry[]
): Promise<void> {
  const transaction = database.transaction(HISTORY_STORE_NAME, 'readwrite')
  const transactionDone = transactionResult(transaction)
  const store = transaction.objectStore(HISTORY_STORE_NAME)
  for (const id of rawIds) store.delete(id)
  for (const entry of entries) {
    store.put({ ...entry, userId } satisfies StoredCanvasHistoryEntry)
  }
  await transactionDone
}

function publishHistoryEvent(
  kind: HistorySyncEvent['kind'],
  userId: number
): void {
  if (typeof window === 'undefined') return
  const event: HistorySyncEvent = {
    kind,
    userId,
    source: historySyncSource,
    timestamp: Date.now(),
  }

  historySyncPublisher ??= createHistoryBroadcastChannel()
  if (historySyncPublisher) {
    try {
      historySyncPublisher.postMessage(event)
      return
    } catch {
      try {
        historySyncPublisher.close()
      } catch {
        // Ignore a failed channel while falling back to storage events.
      }
      historySyncPublisher = null
    }
  }

  try {
    window.localStorage.setItem(HISTORY_SYNC_STORAGE_KEY, JSON.stringify(event))
    window.localStorage.removeItem(HISTORY_SYNC_STORAGE_KEY)
  } catch {
    // Cross-tab synchronization is best-effort when storage is unavailable.
  }
}

function isHistorySyncEvent(value: unknown): value is HistorySyncEvent {
  return (
    isRecord(value) &&
    (value.kind === 'updated' ||
      value.kind === 'removed' ||
      value.kind === 'cleared') &&
    isValidUserId(value.userId as number) &&
    typeof value.source === 'string' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp)
  )
}

export function subscribeHistoryChanges(
  userId: number,
  listener: () => void
): () => void {
  if (typeof window === 'undefined' || !isValidUserId(userId)) {
    return () => undefined
  }

  const deliver = (value: unknown) => {
    if (
      isHistorySyncEvent(value) &&
      value.userId === userId &&
      value.source !== historySyncSource &&
      Math.abs(Date.now() - value.timestamp) < 60_000
    ) {
      listener()
    }
  }

  const channel = createHistoryBroadcastChannel()
  if (channel) {
    const handleMessage = (event: MessageEvent<unknown>) => deliver(event.data)
    try {
      channel.addEventListener('message', handleMessage)
      return () => {
        channel.removeEventListener('message', handleMessage)
        channel.close()
      }
    } catch {
      try {
        channel.close()
      } catch {
        // Ignore a failed channel while falling back to storage events.
      }
    }
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== HISTORY_SYNC_STORAGE_KEY || !event.newValue) return
    try {
      deliver(JSON.parse(event.newValue))
    } catch {
      // Ignore malformed same-origin storage events.
    }
  }
  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}

export async function loadHistory(
  userId: number
): Promise<CanvasHistoryEntry[]> {
  if (!isValidUserId(userId)) return []
  const database = await openHistoryDatabase()
  try {
    return (await readUserEntries(database, userId)).entries.slice(
      0,
      MAX_ENTRIES
    )
  } catch (cause) {
    throw new HistoryStorageError('failed', cause)
  } finally {
    database.close()
  }
}

export async function saveHistoryEntries(
  userId: number,
  entries: CanvasHistoryEntry[]
): Promise<HistorySaveResult> {
  if (!isValidUserId(userId)) return { success: false, reason: 'failed' }
  if (entries.length === 0) return { success: true }
  const validEntries = entries
    .map((entry) => parseHistoryEntry({ ...entry, userId }, userId))
    .filter((entry): entry is CanvasHistoryEntry => entry !== null)
  if (validEntries.length === 0) return { success: false, reason: 'failed' }

  let database: IDBDatabase
  try {
    database = await openHistoryDatabase()
  } catch (cause) {
    const reason =
      cause instanceof HistoryStorageError ? cause.reason : 'failed'
    return { success: false, reason }
  }

  try {
    const current = await readUserEntries(database, userId)
    for (
      let dropCount = 0;
      dropCount <= current.entries.length;
      dropCount += 1
    ) {
      const retained = current.entries.slice(dropCount)
      const next = [...validEntries, ...retained]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, MAX_ENTRIES)
      try {
        await writeUserEntries(database, userId, current.rawIds, next)
        publishHistoryEvent('updated', userId)
        return { success: true }
      } catch (cause) {
        if (!isQuotaError(cause) || dropCount === current.entries.length) {
          return {
            success: false,
            reason: isQuotaError(cause) ? 'quota' : 'failed',
          }
        }
      }
    }
    return { success: false, reason: 'quota' }
  } catch (cause) {
    return { success: false, reason: isQuotaError(cause) ? 'quota' : 'failed' }
  } finally {
    database.close()
  }
}

export async function removeHistoryEntry(
  userId: number,
  id: string
): Promise<void> {
  if (!isValidUserId(userId) || !id) return
  const database = await openHistoryDatabase()
  try {
    const transaction = database.transaction(HISTORY_STORE_NAME, 'readwrite')
    const transactionDone = transactionResult(transaction)
    const store = transaction.objectStore(HISTORY_STORE_NAME)
    const record = (await requestResult(store.get([userId, id]))) as unknown
    if (isRecord(record) && record.userId === userId) {
      store.delete([userId, id])
    }
    await transactionDone
    publishHistoryEvent('removed', userId)
  } catch (cause) {
    throw new HistoryStorageError('failed', cause)
  } finally {
    database.close()
  }
}

export async function restoreHistoryEntry(
  userId: number,
  entry: CanvasHistoryEntry
): Promise<HistorySaveResult> {
  return saveHistoryEntries(userId, [entry])
}

export async function clearHistory(userId: number): Promise<void> {
  if (!isValidUserId(userId)) return
  const database = await openHistoryDatabase()
  try {
    const current = await readUserEntries(database, userId)
    const transaction = database.transaction(HISTORY_STORE_NAME, 'readwrite')
    const transactionDone = transactionResult(transaction)
    const store = transaction.objectStore(HISTORY_STORE_NAME)
    for (const id of current.rawIds) store.delete(id)
    await transactionDone
    publishHistoryEvent('cleared', userId)
  } catch (cause) {
    throw new HistoryStorageError('failed', cause)
  } finally {
    database.close()
  }
}

export function getLegacyHistory(): CanvasHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => parseHistoryEntry(entry))
      .filter((entry): entry is CanvasHistoryEntry => entry !== null)
  } catch {
    return []
  }
}

export function shouldShowLegacyMigrationPrompt(): boolean {
  try {
    return (
      getLegacyHistory().length > 0 &&
      sessionStorage.getItem(MIGRATION_PROMPT_KEY) !== 'true'
    )
  } catch {
    return getLegacyHistory().length > 0
  }
}

export function markLegacyMigrationPromptShown(): void {
  try {
    sessionStorage.setItem(MIGRATION_PROMPT_KEY, 'true')
  } catch {
    // Ignore unavailable session storage.
  }
}

export async function migrateLegacyHistory(
  userId: number
): Promise<HistorySaveResult> {
  const legacyEntries = getLegacyHistory()
  const result = await saveHistoryEntries(userId, legacyEntries)
  if (result.success) {
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      // The migration succeeded even if cleanup is unavailable.
    }
  }
  return result
}

export function discardLegacyHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    // Ignore unavailable storage.
  }
}

export async function persistImageSource(
  src: string
): Promise<PersistedImageSource> {
  if (src.startsWith('data:')) return { image: src, temporary: false }
  try {
    const response = await fetch(src)
    if (!response.ok) return { image: src, temporary: true }
    const blob = await response.blob()
    const image = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener(
        'load',
        () =>
          typeof reader.result === 'string' ? resolve(reader.result) : reject(),
        { once: true }
      )
      reader.addEventListener('error', () => reject(reader.error), {
        once: true,
      })
      reader.readAsDataURL(blob)
    })
    return { image, temporary: false }
  } catch {
    return { image: src, temporary: true }
  }
}

export async function downloadImage(
  src: string,
  filename: string
): Promise<boolean> {
  if (src.startsWith('data:')) {
    const anchor = document.createElement('a')
    anchor.href = src
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return true
  }

  let objectUrl: string | null = null
  try {
    const response = await fetch(src)
    if (!response.ok) return false
    const blob = await response.blob()
    objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return true
  } catch {
    return false
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
