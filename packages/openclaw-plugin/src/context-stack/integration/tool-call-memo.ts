/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  MEMORY_FAULT_RECOVER_TOOL_NAME,
  archiveContent,
  pluginStateSubdir,
} from "@tokenpilot/runtime-core";

type MemoRecord = {
  toolName: string;
  memoKey: string;
  dataKey: string;
  outputFile?: string;
  resultHash: string;
  createdAt: string;
};

type MemoHelpers = {
  safeId: (value: string) => string;
  appendTaskStateTrace?: (stateDir: string, payload: Record<string, unknown>) => Promise<void>;
  logger?: {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
  };
};

const TOOL_RESULT_MEMO = new Map<string, MemoRecord>();
const TOOL_ACCESS_COUNT = new Map<string, number>();
const MAX_MEMO_RECORDS = 2048;
const DEFAULT_TRANSCRIPT_MEMO_MIN_CALLS_BEFORE_BLOCK = 4;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractToolParams(event: any): Record<string, unknown> {
  return isRecord(event?.params) ? { ...(event.params as Record<string, unknown>) } : {};
}

function extractArgsLike(params: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(params.args)) return { ...(params.args as Record<string, unknown>) };
  if (isRecord(params.arguments)) return { ...(params.arguments as Record<string, unknown>) };
  return params;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isTranscriptLikePath(pathValue: string): boolean {
  const lower = pathValue.trim().toLowerCase();
  return lower.endsWith(".md") && lower.includes("transcript");
}

function resolveMaybePath(pathValue: string, workdir?: string): string | undefined {
  const trimmed = pathValue.trim();
  if (!trimmed) return undefined;
  if (isAbsolute(trimmed)) return trimmed;
  if (workdir && workdir.trim().length > 0) return resolve(workdir.trim(), trimmed);
  return undefined;
}

async function maybeHashFile(pathValue: string, workdir?: string): Promise<string | undefined> {
  const resolved = resolveMaybePath(pathValue, workdir);
  if (!resolved) return undefined;
  try {
    const content = await readFile(resolved);
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  } catch {
    return undefined;
  }
}

function findTranscriptPathInCommand(command: string): string | undefined {
  const match = command.match(/([A-Za-z0-9_./-]*transcript(?:[_-][A-Za-z0-9_-]+)?\.md)/i);
  return match?.[1]?.trim();
}

function isUnsafeExecCommand(command: string): boolean {
  const normalized = ` ${command.toLowerCase()} `;
  return (
    normalized.includes(" >")
    || normalized.includes(" >>")
    || normalized.includes(" tee ")
    || normalized.includes(" rm ")
    || normalized.includes(" mv ")
    || normalized.includes(" cp ")
    || normalized.includes(" chmod ")
    || normalized.includes(" chown ")
    || normalized.includes(" mkdir ")
    || normalized.includes(" touch ")
    || normalized.includes(" git commit")
    || normalized.includes(" git add")
    || normalized.includes(" npm ")
    || normalized.includes(" pnpm ")
    || normalized.includes(" yarn ")
    || normalized.includes(" pytest")
    || normalized.includes(" cargo ")
    || normalized.includes(" make ")
  );
}

async function buildMemoKey(event: any): Promise<string | undefined> {
  const toolName = trimText(event?.toolName).toLowerCase();
  const params = extractToolParams(event);
  const target = extractArgsLike(params);

  if (toolName === "read") {
    const pathValue = trimText(target.file_path ?? target.filePath ?? target.path);
    if (!isTranscriptLikePath(pathValue)) return undefined;
    const resolvedPath = resolveMaybePath(pathValue);
    if (!resolvedPath) return undefined;
    const fileHash = await maybeHashFile(pathValue);
    return `transcript:${resolvedPath}:${fileHash ?? "nohash"}`;
  }

  if (toolName !== "exec" && toolName !== "bash") return undefined;
  const command = trimText(target.command ?? target.cmd ?? target.script);
  if (!command || isUnsafeExecCommand(command)) return undefined;
  const transcriptPath = findTranscriptPathInCommand(command);
  if (!transcriptPath) return undefined;
  const workdir = trimText(target.workdir ?? target.cwd);
  const resolvedPath = resolveMaybePath(transcriptPath, workdir);
  if (!resolvedPath) return undefined;
  const fileHash = await maybeHashFile(transcriptPath, workdir);
  return `transcript:${resolvedPath}:${fileHash ?? "nohash"}`;
}

async function extractTranscriptFullText(event: any): Promise<string | undefined> {
  const toolName = trimText(event?.toolName).toLowerCase();
  const params = extractToolParams(event);
  const target = extractArgsLike(params);

  if (toolName === "read") {
    const pathValue = trimText(target.file_path ?? target.filePath ?? target.path);
    if (!isTranscriptLikePath(pathValue)) return undefined;
    const resolved = resolveMaybePath(pathValue);
    if (!resolved) return undefined;
    try {
      return await readFile(resolved, "utf8");
    } catch {
      return undefined;
    }
  }

  if (toolName !== "exec" && toolName !== "bash") return undefined;
  const command = trimText(target.command ?? target.cmd ?? target.script);
  if (!command || isUnsafeExecCommand(command)) return undefined;
  const transcriptPath = findTranscriptPathInCommand(command);
  if (!transcriptPath) return undefined;
  const workdir = trimText(target.workdir ?? target.cwd);
  const resolved = resolveMaybePath(transcriptPath, workdir);
  if (!resolved) return undefined;
  try {
    return await readFile(resolved, "utf8");
  } catch {
    return undefined;
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildDataKey(toolName: string, toolCallId: string, text: string): string {
  const base = toolCallId || hashText(text);
  return `memo:${toolName}:${base}`;
}

function extractTextFromToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result) return "";
  if (Array.isArray(result)) {
    return result.map((item) => extractTextFromToolResult(item)).filter((item) => item.length > 0).join("\n");
  }
  if (!isRecord(result)) return "";
  if (typeof result.text === "string") return result.text;
  if (typeof result.stdout === "string" || typeof result.stderr === "string") {
    return [result.stdout, result.stderr].filter((item): item is string => typeof item === "string" && item.length > 0).join("\n");
  }
  if (Array.isArray(result.content)) {
    return result.content
      .map((item) => {
        if (!isRecord(item)) return "";
        if (typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        return "";
      })
      .filter((item) => item.length > 0)
      .join("\n");
  }
  if (isRecord(result.result)) return extractTextFromToolResult(result.result);
  if (typeof result.result === "string") return result.result;
  return "";
}

function insertMemoRecord(record: MemoRecord): void {
  TOOL_RESULT_MEMO.set(record.memoKey, record);
  while (TOOL_RESULT_MEMO.size > MAX_MEMO_RECORDS) {
    const oldest = TOOL_RESULT_MEMO.keys().next().value;
    if (!oldest) break;
    TOOL_RESULT_MEMO.delete(oldest);
  }
}

function getTranscriptMemoMinCallsBeforeBlock(): number {
  const raw = Number.parseInt(process.env.TOKENPILOT_TRANSCRIPT_MEMO_MIN_CALLS ?? "", 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_TRANSCRIPT_MEMO_MIN_CALLS_BEFORE_BLOCK;
}

export async function recordToolCallMemo(
  event: any,
  cfg: { stateDir: string },
  helpers: MemoHelpers,
): Promise<void> {
  const toolName = trimText(event?.toolName).toLowerCase();
  const memoKey = await buildMemoKey(event);
  if (helpers.appendTaskStateTrace) {
    await helpers.appendTaskStateTrace(cfg.stateDir, {
      stage: "tool_call_memo_after_inspect",
      toolName,
      toolCallId: trimText(event?.toolCallId) || null,
      hasMemoKey: Boolean(memoKey),
    });
  }
  if (!memoKey) return;
  const transcriptFullText = await extractTranscriptFullText(event);
  const text = transcriptFullText ?? extractTextFromToolResult(event?.result);
  if (helpers.appendTaskStateTrace) {
    await helpers.appendTaskStateTrace(cfg.stateDir, {
      stage: "tool_call_memo_after_text",
      toolName,
      toolCallId: trimText(event?.toolCallId) || null,
      textChars: text.length,
    });
  }
  if (!text || text.length < 2048) return;
  const sessionId = trimText(event?.sessionId) || "proxy-session";
  const toolCallId = trimText(event?.toolCallId);
  const dataKey = buildDataKey(toolName || "tool", helpers.safeId(toolCallId), text);
  let outputFile: string | undefined;
  try {
    const archived = await archiveContent({
      sessionId,
      segmentId: toolCallId || hashText(text),
      sourcePass: "memo_tool_result",
      toolName: toolName || "tool",
      dataKey,
      originalText: text,
      archiveDir: pluginStateSubdir(cfg.stateDir, "tool-result-archives", sessionId),
      metadata: {
        toolCallId: toolCallId || undefined,
        persistedBy: "plugin.tool_call_memo",
        memoToolName: toolName || "tool",
      },
    });
    outputFile = archived.archivePath;
  } catch {
    outputFile = undefined;
  }
  if (!outputFile) {
    if (helpers.appendTaskStateTrace) {
      await helpers.appendTaskStateTrace(cfg.stateDir, {
        stage: "tool_call_memo_after_no_datakey",
        toolName,
        toolCallId: toolCallId || null,
      });
    }
    return;
  }
  insertMemoRecord({
    toolName,
    memoKey,
    dataKey,
    outputFile,
    resultHash: hashText(text),
    createdAt: new Date().toISOString(),
  });
  if (helpers.appendTaskStateTrace) {
    await helpers.appendTaskStateTrace(cfg.stateDir, {
      stage: "tool_call_memo_after_stored",
      toolName,
      toolCallId: toolCallId || null,
      memoKey,
      dataKey,
      outputFile: outputFile ?? null,
      textChars: text.length,
    });
  }
}

export async function maybeBlockRepeatedToolCall(
  event: any,
  cfg?: { stateDir: string },
  helpers?: Pick<MemoHelpers, "appendTaskStateTrace">,
): Promise<string | undefined> {
  const memoKey = await buildMemoKey(event);
  const toolName = trimText(event?.toolName).toLowerCase();
  const toolCallId = trimText(event?.toolCallId) || null;
  const accessCount = memoKey ? (TOOL_ACCESS_COUNT.get(memoKey) ?? 0) + 1 : 0;
  if (memoKey) TOOL_ACCESS_COUNT.set(memoKey, accessCount);
  const minCallsBeforeBlock = getTranscriptMemoMinCallsBeforeBlock();
  if (helpers?.appendTaskStateTrace && cfg?.stateDir) {
    await helpers.appendTaskStateTrace(cfg.stateDir, {
      stage: "tool_call_memo_before_lookup",
      toolName,
      toolCallId,
      hasMemoKey: Boolean(memoKey),
      memoKey: memoKey ?? null,
      accessCount: memoKey ? accessCount : null,
      minCallsBeforeBlock,
    });
  }
  if (!memoKey) return undefined;
  const record = TOOL_RESULT_MEMO.get(memoKey);
  const gateOpen = accessCount > minCallsBeforeBlock;
  if (helpers?.appendTaskStateTrace && cfg?.stateDir) {
    await helpers.appendTaskStateTrace(cfg.stateDir, {
      stage: "tool_call_memo_before_result",
      toolName,
      toolCallId,
      memoKey,
      hit: Boolean(record),
      dataKey: record?.dataKey ?? null,
      accessCount,
      minCallsBeforeBlock,
      gateOpen,
    });
  }
  if (!record || !gateOpen) return undefined;
  const outputRef = record.outputFile ? ` Archived result: ${record.outputFile}.` : "";
  return [
    `This ${record.toolName} call targets transcript content that has already been retrieved multiple times with the same content hash (${record.resultHash}).`,
    `You have already accessed this transcript ${accessCount} times in the current session.`,
    `Prefer reusing previously gathered context instead of calling the original tool again.${outputRef}`,
    `Only if you still need the archived full content should you call ${MEMORY_FAULT_RECOVER_TOOL_NAME} with {"dataKey":"${record.dataKey}"}.`,
  ].join(" ");
}
