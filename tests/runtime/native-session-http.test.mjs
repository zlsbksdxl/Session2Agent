import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { RuntimeSessionManager } from '../../dist-electron/electron/runtime/sessionManager.js'
import { startRuntimeHttpServer } from '../../dist-electron/electron/runtimeHttpServer.js'

test('native history HTTP browsing is read-only and import binds one idle graph node', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2a-native-http-'))
  const summary = {
    providerKind: 'codex', providerInstanceId: 'default-codex',
    nativeSessionId: 'native-http-thread', sourceKey: 'codex:test-home',
    title: 'Existing chat', cwd: root,
  }
  const runtime = new RuntimeSessionManager({
    storageFile: path.join(root, 'runtime.json'),
    nativeSessionCatalog: {
      async list(input) {
        assert.equal(input.providerInstanceId, 'default-codex')
        return { sessions: [summary] }
      },
      async read(input) {
        assert.equal(input.nativeSessionId, summary.nativeSessionId)
        return { session: summary, messages: [
          { id: 'old-user', role: 'user', content: 'Earlier question' },
          { id: 'old-assistant', role: 'assistant', content: 'Earlier answer' },
        ] }
      },
    },
  })
  const server = await startRuntimeHttpServer({ runtime, port: 0 })
  const base = `http://${server.host}:${server.port}/api/runtime`
  async function post(route, body) {
    const response = await fetch(`${base}/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  try {
    const before = runtime.getState().controlVersion
    const listed = await post('native-sessions/list', { providerInstanceId: 'default-codex' })
    assert.equal(listed.sessions[0].nativeSessionId, summary.nativeSessionId)
    const details = await post('native-sessions/read', {
      providerInstanceId: 'default-codex', nativeSessionId: summary.nativeSessionId,
    })
    assert.deepEqual(details.messages.map(message => message.content), ['Earlier question', 'Earlier answer'])
    assert.equal(runtime.getState().controlVersion, before)
    assert.equal(runtime.getState().nodes.length, 0)

    const imported = await post('native-sessions/import', {
      providerInstanceId: 'default-codex', nativeSessionId: summary.nativeSessionId,
    })
    const session = imported.state.sessions[imported.sessionId]
    assert.equal(session.status, 'idle')
    assert.equal(session.providerSessionId, summary.nativeSessionId)
    assert.equal(session.nodeId, imported.sessionId)
    assert.equal(session.messages.length, 2)
    assert.equal(session.prepared, undefined)
    const repeated = await post('native-sessions/import', {
      providerInstanceId: 'default-codex', nativeSessionId: summary.nativeSessionId,
    })
    assert.equal(repeated.sessionId, imported.sessionId)
    assert.equal(repeated.alreadyImported, true)
    assert.equal(repeated.state.nodes.length, 1)
  } finally {
    await server.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
