export type NativeSessionProviderKind = 'codex' | 'claude-code';

export type NativeSessionSummary = {
  providerKind: NativeSessionProviderKind;
  providerInstanceId: string;
  nativeSessionId: string;
  sourceKey: string;
  title: string;
  cwd: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  archived?: boolean;
  active?: boolean;
  importedSessionId?: string;
};

export type ListNativeSessionsInput = {
  providerInstanceId: string;
  search?: string;
  cwd?: string;
  cursor?: string;
  limit?: number;
  archived?: boolean;
};

export type ListNativeSessionsResult = {
  sessions: NativeSessionSummary[];
  nextCursor?: string;
  warnings?: string[];
};

export type ReadNativeSessionInput = {
  providerInstanceId: string;
  nativeSessionId: string;
};

export type NativeSessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts?: string;
};

export type NativeSessionDetails = {
  session: NativeSessionSummary;
  messages: NativeSessionMessage[];
  historyTruncated?: boolean;
  warnings?: string[];
};

export type ImportNativeSessionInput = ReadNativeSessionInput & {
  cwd?: string;
};

export type NativeSessionOrigin = {
  sourceKey: string;
  nativeSessionId: string;
  providerKind: NativeSessionProviderKind;
  providerInstanceId: string;
  importedAt: string;
  historyTruncated?: boolean;
};

export type ImportNativeSessionResult<State = unknown> = {
  sessionId: string;
  alreadyImported: boolean;
  state: State;
};
