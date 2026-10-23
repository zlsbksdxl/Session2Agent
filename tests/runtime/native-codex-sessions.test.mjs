import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'

const load = () => import('../../dist-electron/electron/runtime/sessions/nativeCodexSessions.js')

const instance = {
  providerInstanceId: 'codex-custom', kind: 'codex', label: 'Custom Codex',
  binaryPath: '/configured/codex', homePath: '/configured/shared',
  shadowHomePath: '/configured/shadow', launchArgs: ['--profile', 'private'],
  env: { S2A_NON_SECRET: 'value' },
}

function thread(overrides = {}) {
  return {
    id: 'thread-original', sessionId: 'tree-group-id', name: 'Original title',
    preview: 'First user message', cwd: '/workspace/original', model: 'gpt-fixture',
    modelProvider: 'provider-fixture', createdAt: 1700000000, updatedAt: 1700000010,
    status: { type: 'notLoaded' }, historyMode: 'paginated', ephemeral: false,
    cliVersion: '0.160.0', source: 'appServer', path: '/configured/shadow/sessions/rollout.jsonl',
    projectId: null, turns: [], ...overrides,
  }
}

function fixtureClient(handler) {
  const client = new EventEmitter()
  const calls = []
  let closed = false
  client.request = async (method, params) => {
    calls.push({ method, params })
    if (method === 'initialize') return { userAgent: 'fixture/0.160.0' }
    return handler(method, params)
  }
  client.notify = (method) => calls.push({ method })
  client.close = () => { closed = true }
  return { client, calls, closed: () => closed }
}

test('Codex history listing preserves profile launch settings, provider IDs, filters and cursor without starting a turn', async () => {
  const { listCodexNativeSessions } = await load()
  const fixture = fixtureClient((method) => {
    assert.equal(method, 'thread/list')
    return { data: [thread()], nextCursor: 'opaque-next', backwardsCursor: 'opaque-back' }
  })
  let launch
  const result = await listCodexNativeSessions(instance, {
    providerInstanceId: instance.providerInstanceId, search: 'Title', cwd: '/workspace/original',
    archived: true, cursor: 'opaque-first', limit: 25,
  }, { createClient: (options) => { launch = options; return fixture.client } })
  assert.equal(launch.providerInstance, instance)
  assert.equal(result.nextCursor, 'opaque-next')
  assert.equal(result.sessions[0].nativeSessionId, 'thread-original')
  assert.equal(result.sessions[0].title, 'Original title')
  assert.equal(result.sessions[0].model, 'gpt-fixture')
  assert.equal(result.sessions[0].createdAt, '2023-11-14T22:13:20.000Z')
  assert.equal(result.sessions[0].archived, true)
  assert.deepEqual(fixture.calls.map((call) => call.method), ['initialize', 'initialized', 'thread/list'])
  const query = fixture.calls.at(-1).params
  assert.equal(query.searchTerm, 'Title')
  assert.equal(query.cwd, '/workspace/original')
  assert.equal(query.cursor, 'opaque-first')
  assert.equal(query.archived, true)
  assert.equal(query.limit, 25)
  assert.deepEqual(query.modelProviders, [])
  assert.ok(query.sourceKinds.includes('appServer'))
  assert.ok(fixture.closed())
})

test('Codex paginated history projects text in chronological order and never resumes or executes stored tools', async () => {
  const { readCodexNativeSession } = await load()
  const fixture = fixtureClient((method, params) => {
    if (method === 'thread/read') {
      assert.equal(params.includeTurns, false)
      return { thread: thread() }
    }
    assert.equal(method, 'thread/turns/list')
    assert.equal(params.itemsView, 'full')
    assert.equal(params.sortDirection, 'desc')
    if (!params.cursor) return {
      data: [{ id: 'turn-later', status: 'completed', itemsView: 'full', startedAt: 1700000003, completedAt: 1700000005,
        items: [{ type: 'userMessage', id: 'u2', content: [{ type: 'text', text: 'Second question' }] },
          { type: 'commandExecution', id: 'tool', command: 'never execute this' },
          { type: 'agentMessage', id: 'a2', text: 'Second answer', phase: 'final_answer' }] }], nextCursor: 'older',
    }
    assert.equal(params.cursor, 'older')
    return { data: [{ id: 'turn-first', status: 'completed', itemsView: 'full', startedAt: 1700000000,
      items: [{ type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'First question' }] },
        { type: 'agentMessage', id: 'a1', text: 'First answer', phase: 'final_answer' }] }], nextCursor: null }
  })
  const result = await readCodexNativeSession(instance, {
    providerInstanceId: instance.providerInstanceId, nativeSessionId: 'thread-original',
  }, { createClient: () => fixture.client })
  assert.deepEqual(result.messages.map(({ id, role, content }) => ({ id, role, content })), [
    { id: 'u1', role: 'user', content: 'First question' },
    { id: 'a1', role: 'assistant', content: 'First answer' },
    { id: 'u2', role: 'user', content: 'Second question' },
    { id: 'a2', role: 'assistant', content: 'Second answer' },
  ])
  assert.equal(result.session.nativeSessionId, 'thread-original')
  assert.equal(result.historyTruncated, undefined)
  assert.equal(result.messages[0].ts, '2023-11-14T22:13:20.000Z')
  assert.ok(fixture.calls.every(({ method }) => !['thread/resume', 'thread/start', 'turn/start'].includes(method)))
  assert.ok(fixture.closed())
})

test('Codex legacy servers fall back to inline history only when pagination is unsupported', async () => {
  const { readCodexNativeSession } = await load()
  const fixture = fixtureClient((method, params) => {
    if (method === 'thread/turns/list') throw new Error('Codex thread/turns/list failed: Method not found')
    assert.equal(method, 'thread/read')
    return { thread: thread({ historyMode: 'legacy', turns: params.includeTurns ? [{ id: 'legacy-turn', items: [
      { id: 'legacy-user', type: 'userMessage', content: [{ type: 'text', text: 'Legacy question' }] },
      { id: 'legacy-agent', type: 'agentMessage', text: 'Legacy answer' },
    ], status: 'completed' }] : [] }) }
  })
  const result = await readCodexNativeSession(instance, {
    providerInstanceId: instance.providerInstanceId, nativeSessionId: 'thread-original',
  }, { createClient: () => fixture.client })
  assert.deepEqual(result.messages.map((message) => message.content), ['Legacy question', 'Legacy answer'])
  assert.equal(fixture.calls.filter((call) => call.method === 'thread/read').at(-1).params.includeTurns, true)
})

test('Codex read bounds recent displayed history while preserving native identity', async () => {
  const { readCodexNativeSession } = await load()
  const fixture = fixtureClient((method) => method === 'thread/read'
    ? { thread: thread() }
    : { data: [{ id: 'latest', status: 'completed', items: [
      { id: 'older', type: 'userMessage', content: [{ type: 'text', text: 'Older' }] },
      { id: 'newer', type: 'agentMessage', text: 'Newest answer' },
    ] }], nextCursor: 'more-history' })
  const result = await readCodexNativeSession(instance, {
    providerInstanceId: instance.providerInstanceId, nativeSessionId: 'thread-original',
  }, { createClient: () => fixture.client, maxMessages: 1 })
  assert.deepEqual(result.messages.map((message) => message.content), ['Newest answer'])
  assert.equal(result.historyTruncated, true)
  assert.ok(result.warnings.length > 0)
  assert.equal(result.session.nativeSessionId, 'thread-original')
  assert.equal(fixture.calls.filter((call) => call.method === 'thread/turns/list').length, 1)
})

test('Codex byte limits keep valid UTF-8 and communicate display truncation', async () => {
  const { readCodexNativeSession } = await load()
  const fixture = fixtureClient((method) => method === 'thread/read'
    ? { thread: thread() }
    : { data: [{ id: 'turn', status: 'completed', items: [{ id: 'a', type: 'agentMessage', text: '你好世界' }] }], nextCursor: null })
  const result = await readCodexNativeSession(instance, {
    providerInstanceId: instance.providerInstanceId, nativeSessionId: 'thread-original',
  }, { createClient: () => fixture.client, maxHistoryBytes: 7 })
  assert.equal(result.messages[0].content, '你好')
  assert.equal(result.historyTruncated, true)
  assert.equal(Buffer.byteLength(result.messages[0].content), 6)
})

test('Codex history errors close the child and do not mask access failures as legacy fallback', async () => {
  const { readCodexNativeSession } = await load()
  const fixture = fixtureClient((method) => {
    if (method === 'thread/read') return { thread: thread() }
    throw new Error('Thread history is unavailable')
  })
  await assert.rejects(readCodexNativeSession(instance, {
    providerInstanceId: instance.providerInstanceId, nativeSessionId: 'thread-original',
  }, { createClient: () => fixture.client }), /history is unavailable/)
  assert.equal(fixture.calls.filter((call) => call.method === 'thread/read').length, 1)
  assert.ok(fixture.closed())
})
