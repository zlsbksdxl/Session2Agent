// Named model presets for headless runs. Presets are keyed by providerKind
// and merged into createSession runtimeSettings by the headless client; a
// caller's explicit runtimeSettings always win. Models ride the per-session
// runtime-settings path, so headless runs never touch the developer's global
// Claude Code / Codex configuration.
export const modelPresets = {
  'provider-default': {
    'claude-code': {},
    codex: {},
    grok: {},
  },
  cheap: {
    'claude-code': { model: 'claude-haiku-4-5' },
    codex: { model: 'gpt-5.3-codex-spark' },
    // Grok does not currently expose a verified low-cost model contract.
    // An explicit empty entry means "provider default" and prevents the
    // runner from falsely labelling an unknown model as cheap.
    grok: {},
  },
}

export const modelPresetNotes = {
  'provider-default': {
    'claude-code': 'Uses the configured provider default model; no low-cost model is assumed.',
    codex: 'Uses the configured provider default model; no low-cost model is assumed.',
    grok: 'Uses the configured provider default model; no low-cost model is assumed.',
  },
  cheap: {
    grok: 'Grok uses the provider default; no verified cheap model is claimed.',
  },
}
