import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OrreryHarness } from '../../scripts/lib/orrery-client.mjs';

export const name = 'native-session-import';
export const description =
  'Read and import history from a separate real provider session, restart, then continue its original native ID and remembered context.';
export const providers = ['codex', 'claude-code'];
export const timeoutMs = 300_000;

export async function run({ provider, modelPreset, workDir, artifactsDir, log }) {
  const codeword = `S2A-${randomUUID().slice(0, 8)}`;
  const profile = provider.providerKind === 'codex' ? 'default-codex' : 'default-claude-sdk';
  const source = await OrreryHarness.start({ modelPreset });
  let nativeSessionId;
  let sourceSessionId;
  log('source runtime ready; creating a fresh native chat');
  try {
    const created = await source.createSession({
      ...provider,
      providerInstanceId: profile,
      cwd: workDir,
      label: 'Native import acceptance source',
      runtimeSettings: { runtimeMode: 'approval-required' },
      prompt: `Remember the exact codeword ${codeword}. Reply with exactly STORED. Do not use tools or write any files.`,
    });
    sourceSessionId = created.sessionId;
    log('source chat submitted; waiting for its first reply');
    await source.waitForIdle(created.sessionId, { timeoutMs: 120_000 });
    nativeSessionId = (await source.state()).sessions[created.sessionId].providerSessionId;
    assert.ok(nativeSessionId);
    log('source reply complete; native identity recorded');
    const transcript = await source.transcript(created.sessionId);
    fs.writeFileSync(path.join(artifactsDir, 'source-transcript.json'), JSON.stringify(transcript, null, 2));
  } finally {
    if (sourceSessionId) {
      try {
        fs.writeFileSync(path.join(artifactsDir, 'source-state.json'), JSON.stringify(await source.state(), null, 2));
        fs.writeFileSync(path.join(artifactsDir, 'source-transcript.json'), JSON.stringify(await source.transcript(sourceSessionId), null, 2));
      } catch { /* Preserve the original failure if the source runtime exited. */ }
    }
    await source.close();
  }

  const storageFile = path.join(workDir, 'import-runtime.json');
  const destination = await OrreryHarness.start({ modelPreset, storageFile });
  let imported;
  try {
    log('discovering the native chat in a fresh S2A runtime');
    const listing = await destination.listNativeSessions({ providerInstanceId: profile, cwd: workDir, limit: 100 });
    assert.ok(
      listing.sessions.some((session) => session.nativeSessionId === nativeSessionId),
      'native catalog must discover the separate source session',
    );
    const input = { providerInstanceId: profile, nativeSessionId };
    const details = await destination.readNativeSession(input);
    log('history preview loaded; importing without a model turn');
    assert.ok(details.messages.some((message) => message.role === 'user' && message.content.includes(codeword)));
    assert.equal((await destination.sessions()).length, 0, 'browsing must not create local chats');
    imported = await destination.importNativeSession(input);
    const session = imported.state.sessions[imported.sessionId];
    assert.equal(session.status, 'idle');
    assert.equal(session.providerSessionId, nativeSessionId);
    assert.ok(session.messages.some((message) => message.content.includes(codeword)));
    assert.equal((await destination.importNativeSession(input)).sessionId, imported.sessionId);
    assert.equal((await destination.state()).nodes.length, 1);
  } finally {
    await destination.close();
  }

  const resumed = await OrreryHarness.start({ modelPreset, storageFile });
  try {
    log('imported store reopened; continuing the native chat');
    const restored = (await resumed.state()).sessions[imported.sessionId];
    assert.equal(restored.providerSessionId, nativeSessionId);
    const oldMessageCount = restored.messages.length;
    await resumed.resumeSession(imported.sessionId, {
      message: 'What exact codeword did I ask you to remember? Reply with only that codeword. Do not use tools.',
      runtimeSettings: { ...modelPreset?.[provider.providerKind], runtimeMode: 'approval-required' },
    });
    await resumed.waitForIdle(imported.sessionId, { timeoutMs: 120_000 });
    const completed = (await resumed.state()).sessions[imported.sessionId];
    assert.equal(completed.providerSessionId, nativeSessionId, 'continuation must retain the native session ID');
    const transcript = await resumed.transcript(imported.sessionId);
    const reply = transcript.messages
      .slice(oldMessageCount)
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content)
      .join('\n');
    assert.ok(reply.includes(codeword), `native continuation lost the codeword: ${reply}`);
    fs.writeFileSync(path.join(artifactsDir, 'resumed-transcript.json'), JSON.stringify(transcript, null, 2));
    fs.writeFileSync(path.join(artifactsDir, 'resumed-state.json'), JSON.stringify(await resumed.state(), null, 2));
  } finally {
    await resumed.close();
  }
  log(`verified ${provider.providerKind} original native ID, history, duplicate import, persistence and remembered context`);
}
