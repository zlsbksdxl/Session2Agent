import path from 'node:path'
import type {
  ListNativeSessionsInput,
  ListNativeSessionsResult,
  NativeSessionDetails,
  NativeSessionMessage,
  NativeSessionSummary,
  ReadNativeSessionInput,
} from '../../../shared/native-session.js'
import { CodexJsonRpcClient } from '../providers/codexJsonRpcClient.js'
import { resolveProviderLaunch } from '../providers/providerLaunch.js'
import { nativeSessionSourceKey } from './nativeSessionSource.js'

type JsonRecord = Record<string, any>
type CatalogClient = Pick<CodexJsonRpcClient, 'request' | 'notify' | 'close' | 'on'>
type CodexCatalogOptions = {
  createClient?: (input: { cwd: string; providerInstance: JsonRecord }) => CatalogClient
  maxMessages?: number
  maxHistoryBytes?: number
  maxPages?: number
  totalTimeoutMs?: number
}

const sourceKinds = ['cli', 'vscode', 'appServer', 'exec', 'unknown']
const historyWarning = 'Only the most recent messages are displayed. Continuing this chat uses the full native conversation.'

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function timestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const date = new Date(value * 1_000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function summary(instance: JsonRecord, raw: JsonRecord, archived?: boolean): NativeSessionSummary {
  if (!nonEmpty(raw?.id)) throw new Error('Codex returned a thread without an ID.')
  if (!nonEmpty(raw.cwd)) throw new Error('Codex returned a thread without a project folder.')
  const title = nonEmpty(raw.name) ? raw.name.trim() : nonEmpty(raw.preview)
    ? raw.preview.replace(/\s+/g, ' ').trim().slice(0, 180)
    : `Codex ${raw.id.slice(0, 8)}`
  const launch = resolveProviderLaunch('codex', instance)
  const isArchived = archived ?? (typeof raw.path === 'string' ? raw.path.split(/[\\/]/).includes('archived_sessions') : undefined)
  return {
    providerKind: 'codex',
    providerInstanceId: instance.providerInstanceId,
    nativeSessionId: raw.id,
    sourceKey: nativeSessionSourceKey('codex', launch.env),
    title,
    cwd: raw.cwd,
    ...(timestamp(raw.createdAt) ? { createdAt: timestamp(raw.createdAt) } : {}),
    ...(timestamp(raw.updatedAt) ? { updatedAt: timestamp(raw.updatedAt) } : {}),
    ...(nonEmpty(raw.model) ? { model: raw.model } : {}),
    ...(isArchived !== undefined ? { archived: isArchived } : {}),
    ...(raw.status?.type === 'active' ? { active: true } : {}),
  }
}

async function withClient<T>(
  instance: JsonRecord,
  options: CodexCatalogOptions,
  operation: (request: (method: string, params: JsonRecord) => Promise<any>) => Promise<T>,
) {
  const client = (options.createClient ?? ((input) => new CodexJsonRpcClient(input)))({
    cwd: process.cwd(), providerInstance: instance,
  })
  client.on('error', () => {})
  const deadline = Date.now() + (options.totalTimeoutMs ?? 60_000)
  const request = (method: string, params: JsonRecord) => {
    const timeoutMs = deadline - Date.now()
    if (timeoutMs <= 0) throw new Error('Timed out reading Codex session history.')
    return client.request(method, params, { timeoutMs })
  }
  try {
    await request('initialize', {
      clientInfo: { name: 'orrery', title: 'SessionFlow', version: '0.0.0' },
      capabilities: { experimentalApi: true },
    })
    client.notify('initialized')
    return await operation(request)
  } finally {
    client.close()
  }
}

export async function listCodexNativeSessions(
  instance: JsonRecord,
  input: ListNativeSessionsInput,
  options: CodexCatalogOptions = {},
): Promise<ListNativeSessionsResult> {
  return withClient(instance, options, async (request) => {
    const response = await request('thread/list', {
      limit: input.limit ?? 50,
      sourceKinds,
      modelProviders: [],
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: input.archived === true,
      ...(nonEmpty(input.cursor) ? { cursor: input.cursor } : {}),
      ...(nonEmpty(input.search) ? { searchTerm: input.search.trim() } : {}),
      ...(nonEmpty(input.cwd) ? { cwd: path.resolve(input.cwd) } : {}),
    })
    if (!Array.isArray(response?.data)) throw new Error('Codex returned an invalid native session list.')
    return {
      sessions: response.data.map((raw) => summary(instance, raw, input.archived === true)),
      ...(nonEmpty(response.nextCursor) ? { nextCursor: response.nextCursor } : {}),
    }
  })
}

function unsupportedPagination(error: unknown) {
  return /method not found|unknown method|unsupported.method|method.+not supported|-32601/i.test(String((error as Error)?.message ?? error))
}

function messageFor(item: JsonRecord, turn: JsonRecord, offset: number, warnings: Set<string>): NativeSessionMessage | undefined {
  let content: string
  let role: NativeSessionMessage['role']
  if (item?.type === 'userMessage') {
    role = 'user'
    const parts = Array.isArray(item.content) ? item.content : []
    content = parts.flatMap((part) => {
      if (part.type === 'text' && typeof part.text === 'string') return [part.text]
      if (part.type === 'image' || part.type === 'localImage') {
        warnings.add('Image and audio attachments are represented by labels in imported history.')
        return ['[Image attachment]']
      }
      if (part.type === 'audio' || part.type === 'localAudio') {
        warnings.add('Image and audio attachments are represented by labels in imported history.')
        return ['[Audio attachment]']
      }
      if ((part.type === 'mention' || part.type === 'skill') && nonEmpty(part.name)) return [`@${part.name}`]
      return []
    }).join('\n')
  } else if (item?.type === 'agentMessage' && typeof item.text === 'string') {
    role = 'assistant'
    content = item.text
  } else {
    return undefined
  }
  if (!content.trim()) return undefined
  const ts = timestamp(role === 'assistant' ? turn.completedAt ?? turn.startedAt : turn.startedAt)
  return { id: nonEmpty(item.id) ? item.id : `${turn.id}:${offset}`, role, content, ...(ts ? { ts } : {}) }
}

function utf8Prefix(content: string, byteLimit: number) {
  const bytes = Buffer.from(content)
  let end = Math.min(bytes.length, byteLimit)
  while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}

export async function readCodexNativeSession(
  instance: JsonRecord,
  input: ReadNativeSessionInput,
  options: CodexCatalogOptions = {},
): Promise<NativeSessionDetails> {
  return withClient(instance, options, async (request) => {
    const initial = await request('thread/read', { threadId: input.nativeSessionId, includeTurns: false })
    const raw = initial?.thread
    if (raw?.id !== input.nativeSessionId) throw new Error('Codex returned a different native session.')
    const session = summary(instance, raw)
    const reverseMessages: NativeSessionMessage[] = []
    const seen = new Set<string>()
    const warnings = new Set<string>()
    const maxMessages = options.maxMessages ?? 1_000
    const maxBytes = options.maxHistoryBytes ?? 2 * 1024 * 1024
    const maxPages = options.maxPages ?? 50
    let bytes = 0
    let truncated = false
    const collect = (turns: JsonRecord[]) => {
      for (const turn of turns) {
        const items = Array.isArray(turn.items) ? turn.items : []
        for (let offset = items.length - 1; offset >= 0; offset--) {
          const message = messageFor(items[offset], turn, offset, warnings)
          if (!message) continue
          const key = `${turn.id}:${message.id}`
          if (seen.has(key)) continue
          seen.add(key)
          if (reverseMessages.length >= maxMessages || bytes >= maxBytes) { truncated = true; return false }
          const remaining = maxBytes - bytes
          if (Buffer.byteLength(message.content) > remaining) {
            message.content = utf8Prefix(message.content, remaining)
            truncated = true
          }
          bytes += Buffer.byteLength(message.content)
          if (message.content) reverseMessages.push(message)
          if (truncated) return false
        }
      }
      return true
    }
    if (Array.isArray(raw.turns) && raw.turns.length > 0) {
      collect([...raw.turns].reverse())
    } else {
      let cursor: string | undefined
      const cursors = new Set<string>()
      for (let page = 0; page < maxPages; page++) {
        let response: JsonRecord
        try {
          response = await request('thread/turns/list', {
            threadId: input.nativeSessionId, limit: 20, sortDirection: 'desc', itemsView: 'full',
            ...(cursor ? { cursor } : {}),
          })
        } catch (error) {
          if (page !== 0 || !unsupportedPagination(error)) throw error
          const legacy = await request('thread/read', { threadId: input.nativeSessionId, includeTurns: true })
          if (legacy?.thread?.id !== input.nativeSessionId || !Array.isArray(legacy.thread.turns)) {
            throw new Error('Codex returned invalid legacy session history.')
          }
          collect([...legacy.thread.turns].reverse())
          break
        }
        if (!Array.isArray(response?.data)) throw new Error('Codex returned invalid paginated session history.')
        const hasMore = nonEmpty(response.nextCursor)
        if (!collect(response.data)) break
        if (!hasMore) break
        if (reverseMessages.length >= maxMessages || bytes >= maxBytes || page + 1 === maxPages || cursors.has(response.nextCursor)) {
          truncated = true
          break
        }
        cursor = response.nextCursor
        cursors.add(cursor)
      }
    }
    if (truncated) warnings.add(historyWarning)
    return {
      session,
      messages: reverseMessages.reverse(),
      ...(truncated ? { historyTruncated: true } : {}),
      ...(warnings.size ? { warnings: [...warnings] } : {}),
    }
  })
}
