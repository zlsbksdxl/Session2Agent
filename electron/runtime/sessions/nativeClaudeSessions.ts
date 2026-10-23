import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type {
  ListNativeSessionsInput,
  ListNativeSessionsResult,
  NativeSessionDetails,
  ReadNativeSessionInput,
} from '../../../shared/native-session.js'
import { resolveProviderLaunch } from '../providers/providerLaunch.js'
import { nativeSessionSourceKey } from './nativeSessionSource.js'
import type { ClaudeHistoryRequest } from './nativeClaudeHistoryWorker.js'

type JsonRecord = Record<string, any>

function readHistory<T>(environment: NodeJS.ProcessEnv, request: ClaudeHistoryRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    // History APIs use process-global Claude configuration. A fresh Node process
    // gives each provider profile its own root without mutating Electron's env.
    const worker = fork(fileURLToPath(new URL('./nativeClaudeHistoryWorker.js', import.meta.url)), [], {
      execArgv: [],
      env: {
        ...environment,
        ELECTRON_RUN_AS_NODE: '1',
        // Read the complete chain before applying our own visible-history cap.
        CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP: '1',
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    })
    let settled = false
    const finish = (error?: Error, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (error) {
        worker.kill('SIGKILL')
        reject(error)
      } else {
        resolve(value as T)
      }
    }
    const deadline = setTimeout(() => finish(new Error('Reading Claude history timed out. Try narrowing the project or search.')), 30_000)
    deadline.unref()
    worker.once('error', (error) => finish(error))
    worker.once('exit', (code, signal) => {
      if (!settled) finish(new Error(`Claude history reader exited before returning a result (${signal ?? code ?? 'unknown'}).`))
    })
    worker.once('message', (response: { ok?: boolean; value?: T; error?: string }) => {
      if (response?.ok === true) finish(undefined, response.value)
      else finish(new Error(typeof response?.error === 'string' ? response.error : 'Claude history reader returned an invalid result.'))
    })
    worker.send(request, (error) => {
      if (error) finish(error)
    })
  })
}

export async function listClaudeNativeSessions(instance: JsonRecord, input: ListNativeSessionsInput): Promise<ListNativeSessionsResult> {
  const { env } = resolveProviderLaunch('claude-code', instance)
  return readHistory(env, {
    operation: 'list',
    input,
    providerInstanceId: instance.providerInstanceId,
    sourceKey: nativeSessionSourceKey('claude-code', env),
  })
}

export async function readClaudeNativeSession(instance: JsonRecord, input: ReadNativeSessionInput): Promise<NativeSessionDetails> {
  const { env } = resolveProviderLaunch('claude-code', instance)
  return readHistory(env, {
    operation: 'read',
    input,
    providerInstanceId: instance.providerInstanceId,
    sourceKey: nativeSessionSourceKey('claude-code', env),
  })
}
