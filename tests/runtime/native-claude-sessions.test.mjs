import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import * as native from '../../dist-electron/electron/runtime/sessions/nativeClaudeSessions.js'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 's2a-claude-history-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

async function sessionFile(config, { id = randomUUID(), title, cwd = '/missing/history/workspace', texts = ['Original user text', 'Original assistant text'], modified = 1_700_000_000_000 }) {
  const directory = path.join(config, 'projects', 'stored-project')
  await fs.mkdir(directory, { recursive: true })
  let parentUuid = null
  const entries = texts.map((text, index) => {
    const uuid = randomUUID()
    const entry = {
      type: index % 2 === 0 ? 'user' : 'assistant',
      uuid,
      parentUuid,
      sessionId: id,
      cwd,
      timestamp: `2026-10-22T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
      message: { role: index % 2 === 0 ? 'user' : 'assistant', content: text },
    }
    parentUuid = uuid
    return entry
  })
  entries.push({ type: 'custom-title', sessionId: id, customTitle: title })
  const file = path.join(directory, `${id}.jsonl`)
  await fs.writeFile(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  await fs.utimes(file, modified / 1000, modified / 1000)
  return { id, file, entries }
}

function profile(config, providerInstanceId = 'claude-fixture') {
  return { kind: 'claude-code', providerInstanceId, binaryPath: '/missing/claude-must-not-launch', env: { CLAUDE_CONFIG_DIR: config } }
}

test('Claude catalog isolates concurrent provider roots without changing the parent environment', async (t) => {
  const root = await fixture(t)
  const firstConfig = path.join(root, 'first-config')
  const secondConfig = path.join(root, 'second-config')
  const id = randomUUID()
  await sessionFile(firstConfig, { id, title: 'First profile' })
  await sessionFile(secondConfig, { id, title: 'Second profile' })
  const environment = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
  const [first, second] = await Promise.all([
    native.listClaudeNativeSessions(profile(firstConfig, 'first'), { providerInstanceId: 'first' }),
    native.listClaudeNativeSessions(profile(secondConfig, 'second'), { providerInstanceId: 'second' }),
  ])
  assert.deepEqual(first.sessions.map((session) => session.title), ['First profile'])
  assert.deepEqual(second.sessions.map((session) => session.title), ['Second profile'])
  assert.equal(first.sessions[0].nativeSessionId, id)
  assert.equal(first.sessions[0].providerKind, 'claude-code')
  assert.equal(first.sessions[0].providerInstanceId, 'first')
  assert.notEqual(first.sessions[0].sourceKey, second.sessions[0].sourceKey)
  assert.deepEqual({ HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }, environment)
})

test('Claude catalog paginates matching search results instead of only searching the current page', async (t) => {
  const config = await fixture(t)
  await sessionFile(config, { title: 'Newest unrelated', modified: 1_700_000_000_004 })
  const first = await sessionFile(config, { title: 'Needle first', modified: 1_700_000_000_003 })
  await sessionFile(config, { title: 'Middle unrelated', modified: 1_700_000_000_002 })
  const second = await sessionFile(config, { title: 'Needle second', modified: 1_700_000_000_001 })
  const input = { providerInstanceId: 'claude-fixture', search: 'NEEDLE', limit: 1 }
  const pageOne = await native.listClaudeNativeSessions(profile(config), input)
  assert.deepEqual(pageOne.sessions.map((session) => session.nativeSessionId), [first.id])
  assert.ok(pageOne.nextCursor)
  const pageTwo = await native.listClaudeNativeSessions(profile(config), { ...input, cursor: pageOne.nextCursor })
  assert.deepEqual(pageTwo.sessions.map((session) => session.nativeSessionId), [second.id])
  assert.equal(pageTwo.nextCursor, undefined)
})

test('Claude read finds native history despite a missing cwd and preserves only original conversation text', async (t) => {
  const config = await fixture(t)
  const userText = '  Original UPPERCASE user text\nDo not rewrite.  '
  const assistantText = 'Original assistant text\nSecond paragraph.'
  const stored = await sessionFile(config, { title: 'Moved project', texts: [userText, assistantText] })
  const before = await fs.readFile(stored.file, 'utf8')
  const details = await native.readClaudeNativeSession(profile(config), { providerInstanceId: 'claude-fixture', nativeSessionId: stored.id })
  assert.equal(details.session.nativeSessionId, stored.id)
  assert.equal(details.session.cwd, '/missing/history/workspace')
  assert.deepEqual(details.messages, [
    { id: stored.entries[0].uuid, role: 'user', content: userText, ts: '2026-10-22T00:00:00.000Z' },
    { id: stored.entries[1].uuid, role: 'assistant', content: assistantText, ts: '2026-10-22T00:00:01.000Z' },
  ])
  assert.equal(details.historyTruncated, undefined)
  assert.equal(await fs.readFile(stored.file, 'utf8'), before)
})

test('Claude read does not turn thinking, tool calls, or tool results into chat prose', async (t) => {
  const config = await fixture(t)
  const stored = await sessionFile(config, { title: 'Text blocks', texts: [
    [{ type: 'text', text: 'User request' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }],
    [{ type: 'thinking', thinking: 'Internal reasoning' }, { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} }, { type: 'text', text: ' Visible response ' }],
    [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'File contents must not become user prose' }],
  ] })
  const details = await native.readClaudeNativeSession(profile(config), { providerInstanceId: 'claude-fixture', nativeSessionId: stored.id })
  assert.deepEqual(details.messages.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: 'User request' },
    { role: 'assistant', content: ' Visible response ' },
  ])
})

test('Claude read bounds imported display history to the newest 1000 text messages', async (t) => {
  const config = await fixture(t)
  const stored = await sessionFile(config, { title: 'Long history', texts: Array.from({ length: 1002 }, (_, index) => `Message ${index}`) })
  const details = await native.readClaudeNativeSession(profile(config), { providerInstanceId: 'claude-fixture', nativeSessionId: stored.id })
  assert.equal(details.messages.length, 1000)
  assert.equal(details.messages[0].content, 'Message 2')
  assert.equal(details.messages.at(-1).content, 'Message 1001')
  assert.equal(details.historyTruncated, true)
  assert.ok(details.warnings?.length)
})

test('Claude read bounds text bytes without rewriting or partially cutting a message', async (t) => {
  const config = await fixture(t)
  const long = '字'.repeat(400_000)
  const stored = await sessionFile(config, { title: 'Large history', texts: [long, long, 'Latest reply'] })
  const details = await native.readClaudeNativeSession(profile(config), { providerInstanceId: 'claude-fixture', nativeSessionId: stored.id })
  assert.deepEqual(details.messages.map((message) => message.id), [stored.entries[1].uuid, stored.entries[2].uuid])
  assert.equal(details.messages[0].content, long)
  assert.ok(details.messages.reduce((bytes, message) => bytes + Buffer.byteLength(message.content), 0) <= 2 * 1024 * 1024)
  assert.equal(details.historyTruncated, true)
  assert.ok(details.warnings?.length)
})

test('Claude catalog rejects malformed cursors and read reports missing native sessions', async (t) => {
  const config = await fixture(t)
  await assert.rejects(native.listClaudeNativeSessions(profile(config), { providerInstanceId: 'claude-fixture', cursor: '../escape' }), /cursor/i)
  await assert.rejects(native.readClaudeNativeSession(profile(config), { providerInstanceId: 'claude-fixture', nativeSessionId: randomUUID() }), /not found/i)
})

test('Claude read rejects duplicate native IDs rather than previewing an arbitrary transcript', async (t) => {
  const config = await fixture(t)
  const stored = await sessionFile(config, { title: 'Duplicated history' })
  const duplicateDirectory = path.join(config, 'projects', 'duplicate-project')
  await fs.mkdir(duplicateDirectory)
  await fs.copyFile(stored.file, path.join(duplicateDirectory, `${stored.id}.jsonl`))
  await assert.rejects(native.readClaudeNativeSession(profile(config), { providerInstanceId: 'claude-fixture', nativeSessionId: stored.id }), /multiple|ambiguous|duplicate/i)
})
