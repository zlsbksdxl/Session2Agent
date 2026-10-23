import assert from 'node:assert/strict'
import test from 'node:test'
import * as adapter from '../../dist-electron/electron/runtime/providers/codexAppServerAdapter.js'

const params = {
  threadId: '01a16227-6d96-71f0-91ee-62100aea2af3',
  cwd: '/disposable-project',
  config: { mcp_servers: { fixture: { command: 'fixture' } } },
}
const archivedError = (threadId = params.threadId) => new Error(
  `Codex thread/resume failed: session ${threadId} is archived. Run \`codex unarchive ${threadId}\` to unarchive it first.`,
)

test('Codex normal resume does not change native archive state', async () => {
  const calls = []
  const expected = { thread: { id: params.threadId } }
  const client = { async request(method, input, options) {
    calls.push({ method, input, options })
    return expected
  } }
  const result = await adapter.resumeCodexThreadWithArchiveRecovery(client, params, { timeoutMs: 1234 })
  assert.equal(result, expected)
  assert.deepEqual(calls, [{ method: 'thread/resume', input: params, options: { timeoutMs: 1234 } }])
})

test('Codex exact archived error restores only that thread and retries the same resume once', async () => {
  const calls = []
  const client = { async request(method, input) {
    calls.push({ method, input })
    if (calls.length === 1) throw archivedError()
    return method === 'thread/resume' ? { thread: { id: params.threadId } } : {}
  } }
  const result = await adapter.resumeCodexThreadWithArchiveRecovery(client, params)
  assert.equal(result.thread.id, params.threadId)
  assert.deepEqual(calls, [
    { method: 'thread/resume', input: params },
    { method: 'thread/unarchive', input: { threadId: params.threadId } },
    { method: 'thread/resume', input: params },
  ])
})

test('Codex permission, unrelated and different-thread errors never cancel archive state', async () => {
  for (const error of [
    new Error('Codex thread/resume failed: Permission denied'),
    new Error('Codex thread/resume failed: Thread not found'),
    archivedError('different-thread'),
    new Error(`Permission denied: session ${params.threadId} is archived. Run \`codex unarchive ${params.threadId}\` to unarchive it first.`),
  ]) {
    const calls = []
    const client = { async request(method) { calls.push(method); throw error } }
    await assert.rejects(adapter.resumeCodexThreadWithArchiveRecovery(client, params), (received) => received === error)
    assert.deepEqual(calls, ['thread/resume'])
  }
})

test('Codex unarchive failure is propagated without another resume attempt', async () => {
  const failure = new Error('Codex thread/unarchive failed: Permission denied')
  const calls = []
  const client = { async request(method) {
    calls.push(method)
    if (method === 'thread/resume') throw archivedError()
    throw failure
  } }
  await assert.rejects(adapter.resumeCodexThreadWithArchiveRecovery(client, params), (received) => received === failure)
  assert.deepEqual(calls, ['thread/resume', 'thread/unarchive'])
})

test('Codex archive recovery never loops when the retried resume is still rejected', async () => {
  const rejection = archivedError()
  const calls = []
  const client = { async request(method) {
    calls.push(method)
    if (method === 'thread/resume') throw rejection
    return {}
  } }
  await assert.rejects(adapter.resumeCodexThreadWithArchiveRecovery(client, params), (received) => received === rejection)
  assert.deepEqual(calls, ['thread/resume', 'thread/unarchive', 'thread/resume'])
})
