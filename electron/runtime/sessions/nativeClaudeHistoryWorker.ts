import { getSessionInfo, getSessionMessages, listSessions, type SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  ListNativeSessionsInput,
  ListNativeSessionsResult,
  NativeSessionDetails,
  NativeSessionMessage,
  NativeSessionSummary,
  ReadNativeSessionInput,
} from '../../../shared/native-session.js'

export type ClaudeHistoryRequest = {
  providerInstanceId: string
  sourceKey: string
} & (
  | { operation: 'list'; input: ListNativeSessionsInput }
  | { operation: 'read'; input: ReadNativeSessionInput }
)

const maximumMessages = 1000
const maximumTextBytes = 2 * 1024 * 1024
const catalogBatchSize = 200
const maximumCatalogScan = 5000

function isoTimestamp(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) return undefined
  const date = new Date(value!)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function sessionSummary(info: SDKSessionInfo, request: ClaudeHistoryRequest): NativeSessionSummary {
  return {
    providerKind: 'claude-code',
    providerInstanceId: request.providerInstanceId,
    nativeSessionId: info.sessionId,
    sourceKey: request.sourceKey,
    title: info.customTitle || info.summary || info.firstPrompt || 'Claude session',
    cwd: info.cwd ?? '',
    createdAt: isoTimestamp(info.createdAt),
    updatedAt: isoTimestamp(info.lastModified),
  }
}

function catalogOffset(cursor: string | undefined): number {
  if (cursor === undefined || cursor === '') return 0
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new Error('Invalid Claude history cursor.')
  return Number(cursor)
}

async function listHistory(request: Extract<ClaudeHistoryRequest, { operation: 'list' }>): Promise<ListNativeSessionsResult> {
  const { input } = request
  let offset = catalogOffset(input.cursor)
  if (input.archived === true) return { sessions: [], warnings: ['Claude history does not expose a native archive state.'] }
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.floor(input.limit!))) : 50
  const search = input.search?.trim().toLocaleLowerCase() ?? ''
  const sessions: NativeSessionSummary[] = []
  let scanned = 0
  while (scanned < maximumCatalogScan) {
    const batchLimit = Math.min(catalogBatchSize, maximumCatalogScan - scanned)
    const batch = await listSessions({
      ...(input.cwd?.trim() ? { dir: input.cwd.trim() } : {}),
      limit: batchLimit,
      offset,
      includeProgrammatic: true,
    })
    for (const info of batch) {
      const matches = !search || [info.customTitle, info.summary, info.firstPrompt, info.cwd, info.sessionId]
        .some((value) => value?.toLocaleLowerCase().includes(search))
      if (matches) {
        if (sessions.length === limit) return { sessions, nextCursor: String(offset) }
        sessions.push(sessionSummary(info, request))
      }
      offset += 1
      scanned += 1
    }
    if (batch.length < batchLimit) return { sessions }
  }
  return { sessions, nextCursor: String(offset), warnings: ['More history is available. Continue loading or narrow the search.'] }
}

function visibleText(message: unknown): string {
  if (typeof message === 'string') return message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

async function assertUnambiguousSession(id: string) {
  const config = (process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')).normalize('NFC')
  const projects = path.join(config, 'projects')
  const directories = await fs.readdir(projects).catch(() => [])
  let copies = 0
  for (const directory of directories) {
    const file = await fs.stat(path.join(projects, directory, `${id}.jsonl`)).catch(() => undefined)
    if (!file?.isFile() || file.size === 0) continue
    copies += 1
    if (copies > 1) throw new Error('Multiple Claude transcripts share this session ID. Resolve the duplicate native history files before importing.')
  }
}

async function readHistory(request: Extract<ClaudeHistoryRequest, { operation: 'read' }>): Promise<NativeSessionDetails> {
  const id = request.input.nativeSessionId
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid Claude native session ID.')
  await assertUnambiguousSession(id)
  // Metadata cwd can be missing or refer to a moved checkout. Search this
  // profile's whole history root by native ID rather than treating cwd as a key.
  const info = await getSessionInfo(id)
  if (!info) throw new Error('Claude session was not found in this provider profile.')
  const entries = await getSessionMessages(id)
  const conversation: NativeSessionMessage[] = []
  for (const entry of entries) {
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    const content = visibleText(entry.message)
    if (!content.trim()) continue
    const timestamp = (entry as unknown as { timestamp?: unknown }).timestamp
    conversation.push({ id: entry.uuid, role: entry.type, content, ...(typeof timestamp === 'string' ? { ts: timestamp } : {}) })
  }
  const messages: NativeSessionMessage[] = []
  let bytes = 0
  for (let index = conversation.length - 1; index >= 0 && messages.length < maximumMessages; index -= 1) {
    const message = conversation[index]
    const messageBytes = Buffer.byteLength(message.content, 'utf8')
    if (bytes + messageBytes > maximumTextBytes) break
    bytes += messageBytes
    messages.push(message)
  }
  messages.reverse()
  const truncated = messages.length < conversation.length
  return {
    session: sessionSummary(info, request),
    messages,
    ...(truncated ? {
      historyTruncated: true,
      warnings: ['Some older history is omitted from this preview. Continuing keeps the original Claude session context.'],
    } : {}),
  }
}

if (process.send) {
  process.once('message', async (request: ClaudeHistoryRequest) => {
    try {
      const value = request.operation === 'list' ? await listHistory(request) : await readHistory(request)
      process.send!({ ok: true, value }, () => process.exit(0))
    } catch (error) {
      process.send!({ ok: false, error: error instanceof Error ? error.message : 'Could not read Claude history.' }, () => process.exit(1))
    }
  })
}
