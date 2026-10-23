import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('Native session identities follow canonical provider roots across profiles and exclude credentials', async (t) => {
  const { nativeSessionSourceKey } = await import('../../dist-electron/electron/runtime/sessions/nativeSessionSource.js')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2a-native-source-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, '.codex'))
  fs.symlinkSync(path.join(root, '.codex'), path.join(root, 'linked'))
  assert.equal(nativeSessionSourceKey('codex', { HOME: root }), nativeSessionSourceKey('codex', { CODEX_HOME: path.join(root, 'linked'), API_KEY: 'credential-never-identity' }))
  assert.notEqual(nativeSessionSourceKey('codex', { HOME: root }), nativeSessionSourceKey('codex', { CODEX_HOME: path.join(root, 'other') }))
  assert.equal(nativeSessionSourceKey('claude-code', { HOME: root }), nativeSessionSourceKey('claude-code', { CLAUDE_CONFIG_DIR: path.join(root, '.claude'), TOKEN: 'different' }))
  assert.notEqual(nativeSessionSourceKey('codex', { CODEX_HOME: root }), nativeSessionSourceKey('claude-code', { CLAUDE_CONFIG_DIR: root }))
})

test('Native catalog validates profile and native ID before touching provider history', async () => {
  const { NativeSessionCatalog } = await import('../../dist-electron/electron/runtime/sessions/nativeSessionCatalog.js')
  let reads = 0
  const catalog = new NativeSessionCatalog({
    listCodex: async () => { reads++; return { sessions: [] } },
    readCodex: async () => { reads++; throw new Error('unexpected read') },
  })
  await assert.rejects(catalog.list({ providerInstanceId: 'missing' }, []), /Unknown provider profile/)
  await assert.rejects(catalog.list({ providerInstanceId: 'grok' }, [{ providerInstanceId: 'grok', kind: 'grok' }]), /Codex and Claude/)
  await assert.rejects(catalog.read({ providerInstanceId: 'codex', nativeSessionId: ' ' }, [{ providerInstanceId: 'codex', kind: 'codex' }]), /Native session ID/)
  await assert.rejects(catalog.list({ providerInstanceId: 'codex', limit: -1 }, [{ providerInstanceId: 'codex', kind: 'codex' }]), /limit/i)
  assert.equal(reads, 0)
})

test('Native catalog dispatches the selected supported profile and preserves pagination', async () => {
  const { NativeSessionCatalog } = await import('../../dist-electron/electron/runtime/sessions/nativeSessionCatalog.js')
  const codex = { providerInstanceId: 'custom-codex', kind: 'codex', homePath: '/profile/root' }
  const claude = { providerInstanceId: 'custom-claude', kind: 'claude-code', homePath: '/profile/home' }
  const catalog = new NativeSessionCatalog({
    listCodex: async (profile, query) => {
      assert.equal(profile, codex)
      assert.equal(query.cursor, 'cursor-one')
      return { sessions: [], nextCursor: 'cursor-two' }
    },
    readClaude: async (profile, query) => {
      assert.equal(profile, claude)
      assert.equal(query.nativeSessionId, 'native-claude')
      return { session: { nativeSessionId: 'native-claude' }, messages: [] }
    },
  })
  assert.deepEqual(await catalog.list({ providerInstanceId: 'custom-codex', cursor: 'cursor-one' }, [codex, claude]), { sessions: [], nextCursor: 'cursor-two' })
  assert.equal((await catalog.read({ providerInstanceId: 'custom-claude', nativeSessionId: 'native-claude' }, [codex, claude])).session.nativeSessionId, 'native-claude')
})
