import type {
  ListNativeSessionsInput,
  ListNativeSessionsResult,
  NativeSessionDetails,
  ReadNativeSessionInput,
} from '../../../shared/native-session.js'
import { listCodexNativeSessions, readCodexNativeSession } from './nativeCodexSessions.js'
import { listClaudeNativeSessions, readClaudeNativeSession } from './nativeClaudeSessions.js'

type JsonRecord = Record<string, any>
type CatalogReaders = {
  listCodex?: typeof listCodexNativeSessions
  readCodex?: typeof readCodexNativeSession
  listClaude?: typeof listClaudeNativeSessions
  readClaude?: typeof readClaudeNativeSession
}

function profileFor(input: { providerInstanceId: string }, instances: JsonRecord[]) {
  const id = typeof input?.providerInstanceId === 'string' ? input.providerInstanceId.trim() : ''
  const profile = instances.find((instance) => instance.providerInstanceId === id)
  if (!profile) throw new Error(`Unknown provider profile: ${id}`)
  if (profile.kind !== 'codex' && profile.kind !== 'claude-code') {
    throw new Error('Native session history is available for Codex and Claude only.')
  }
  return profile
}

export class NativeSessionCatalog {
  #readers: CatalogReaders

  constructor(readers: CatalogReaders = {}) {
    this.#readers = readers
  }

  async list(input: ListNativeSessionsInput, instances: JsonRecord[]): Promise<ListNativeSessionsResult> {
    const profile = profileFor(input, instances)
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) {
      throw new Error('Native session page limit must be an integer between 1 and 100.')
    }
    for (const key of ['search', 'cwd', 'cursor'] as const) {
      if (input[key] !== undefined && typeof input[key] !== 'string') {
        throw new Error(`Native session ${key} must be a string.`)
      }
    }
    if (input.archived !== undefined && typeof input.archived !== 'boolean') {
      throw new Error('Native session archived filter must be a boolean.')
    }
    const read = profile.kind === 'codex'
      ? this.#readers.listCodex ?? listCodexNativeSessions
      : this.#readers.listClaude ?? listClaudeNativeSessions
    return read(profile, input)
  }

  async read(input: ReadNativeSessionInput, instances: JsonRecord[]): Promise<NativeSessionDetails> {
    const profile = profileFor(input, instances)
    const id = typeof input.nativeSessionId === 'string' ? input.nativeSessionId.trim() : ''
    if (!id) throw new Error('Native session ID is required.')
    const read = profile.kind === 'codex'
      ? this.#readers.readCodex ?? readCodexNativeSession
      : this.#readers.readClaude ?? readClaudeNativeSession
    return read(profile, { ...input, nativeSessionId: id })
  }
}
