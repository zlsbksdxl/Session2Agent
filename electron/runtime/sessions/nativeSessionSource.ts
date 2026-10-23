import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { NativeSessionProviderKind } from '../../../shared/native-session.js'

export function nativeSessionSourceKey(
  kind: NativeSessionProviderKind,
  environment: NodeJS.ProcessEnv,
): string {
  const home = environment.HOME?.trim() || os.homedir()
  const configured = kind === 'codex'
    ? environment.CODEX_HOME?.trim()
    : environment.CLAUDE_CONFIG_DIR?.trim()
  const root = configured || path.join(home, kind === 'codex' ? '.codex' : '.claude')
  const expanded = root === '~' ? home : root.startsWith('~/') ? path.join(home, root.slice(2)) : root
  let canonical = path.resolve(expanded)
  try {
    canonical = fs.realpathSync.native(canonical)
  } catch {
    // Missing provider roots still need a stable identity before first use.
  }
  return `${kind}:${createHash('sha256').update(canonical).digest('hex')}`
}
