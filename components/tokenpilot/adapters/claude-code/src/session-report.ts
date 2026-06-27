import {
  loadClaudeCodeRecentTurnBindings,
  loadClaudeCodeSessionSnapshot,
  resolveLatestClaudeCodeSessionId,
  type ClaudeCodeRecentTurnBinding,
} from "./session-state.js";

export type ClaudeCodeSessionTopology = {
  sessionId: string;
  latestResponseId?: string;
  previousResponseId?: string;
  responseChain: string[];
  latestModel?: string;
  workspaceHint?: string;
  requestChars?: number;
  responseChars?: number;
  assistantChars?: number;
  reductionSavedChars?: number;
  updatedAt?: string;
  turnCount: number;
};

function normalizeSessionId(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function buildResponseChain(bindings: ClaudeCodeRecentTurnBinding[]): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const binding of bindings) {
    const responseId = normalizeSessionId(binding.responseId);
    if (!responseId || seen.has(responseId)) continue;
    seen.add(responseId);
    chain.push(responseId);
  }
  return chain;
}

export async function resolveClaudeCodeSessionTopology(
  stateDir: string,
  sessionRef?: string,
): Promise<ClaudeCodeSessionTopology | undefined> {
  const sessionId = normalizeSessionId(sessionRef) ?? await resolveLatestClaudeCodeSessionId(stateDir);
  if (!sessionId) return undefined;

  const [snapshot, bindings] = await Promise.all([
    loadClaudeCodeSessionSnapshot(stateDir, sessionId),
    loadClaudeCodeRecentTurnBindings(stateDir, sessionId, 12),
  ]);
  if (!snapshot && bindings.length === 0) return undefined;

  return {
    sessionId,
    latestResponseId: normalizeSessionId(snapshot?.latestResponseId) ?? normalizeSessionId(bindings[0]?.responseId),
    previousResponseId: normalizeSessionId(snapshot?.previousResponseId) ?? normalizeSessionId(bindings[0]?.previousResponseId),
    responseChain: buildResponseChain(bindings),
    latestModel: normalizeSessionId(snapshot?.latestModel) ?? normalizeSessionId(bindings[0]?.model),
    workspaceHint: normalizeSessionId(snapshot?.workspaceHint),
    requestChars: snapshot?.requestChars ?? bindings[0]?.requestChars,
    responseChars: snapshot?.responseChars ?? bindings[0]?.responseChars,
    assistantChars: snapshot?.assistantChars ?? bindings[0]?.assistantChars,
    reductionSavedChars: snapshot?.reductionSavedChars ?? bindings[0]?.reductionSavedChars,
    updatedAt: normalizeSessionId(snapshot?.updatedAt) ?? normalizeSessionId(bindings[0]?.updatedAt),
    turnCount: bindings.length,
  };
}
