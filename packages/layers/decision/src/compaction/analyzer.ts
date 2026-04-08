import type { ContextSegment } from "@ecoclaw/kernel";
import type { CompactionDecision, CompactionInstruction } from "../types.js";

// ============================================================================
// Types
// ============================================================================

type AsObject<T> = T extends Record<string, unknown> ? T : Record<string, unknown>;

// ============================================================================
// Utilities
// ============================================================================

const asObject = <T>(value: unknown): AsObject<T> | undefined => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AsObject<T>)
    : undefined;
};

const normalizeToolName = (metadata: Record<string, unknown> | undefined): string | undefined => {
  const toolPayload = asObject(metadata?.toolPayload);
  const directToolName = typeof metadata?.toolName === "string" ? metadata.toolName : undefined;
  const payloadToolName =
    typeof toolPayload?.toolName === "string" ? (toolPayload.toolName as string) : undefined;
  const raw = directToolName ?? payloadToolName;
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

const extractDataKey = (metadata: Record<string, unknown> | undefined): string | undefined => {
  const toolPayload = asObject(metadata?.toolPayload);
  const candidates = [
    metadata?.path,
    metadata?.file_path,
    metadata?.filePath,
    toolPayload?.path,
    toolPayload?.file_path,
    toolPayload?.filePath,
  ];
  for (const value of candidates) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    return trimmed;
  }
  return undefined;
};

const isSuccessfulWriteLike = (text: string): boolean => {
  const lowered = text.toLowerCase();
  if (/successfully (wrote|updated|edited|applied)/i.test(text)) return true;
  if (lowered.includes('"status":"success"') || lowered.includes('"status": "success"')) return true;
  if (lowered.includes("'status': 'success'")) return true;
  return false;
};

type ReadInfo = {
  index: number;
  segmentId: string;
  toolName: string;
  dataKey: string;
  text: string;
};

type WriteInfo = {
  index: number;
  segmentId: string;
  toolName: string;
  text: string;
};

// ============================================================================
// Turn-Local Compaction Analyzer (Consumption-Based)
// ============================================================================

export type TurnLocalCompactionAnalyzerConfig = {
  enabled?: boolean;
  minSavedChars?: number;
  delayTurns?: number;
};

const DEFAULT_TURN_LOCAL_CONFIG: Required<TurnLocalCompactionAnalyzerConfig> = {
  enabled: true,
  minSavedChars: 100,
  delayTurns: 0,
};

/**
 * Analyze context for turn-local compaction opportunities.
 *
 * Strategy:
 * - Detect read operations that have been "consumed" by subsequent write operations
 * - When a write is detected, mark ALL read results that appeared before it as candidates
 * - This assumes writes "consume" the context from prior reads
 */
export function analyzeTurnLocalCompaction(
  segments: ContextSegment[],
  config: TurnLocalCompactionAnalyzerConfig = DEFAULT_TURN_LOCAL_CONFIG,
): CompactionDecision {
  const cfg = { ...DEFAULT_TURN_LOCAL_CONFIG, ...config };

  if (!cfg.enabled) {
    return {
      enabled: false,
      instructions: [],
      estimatedSavedChars: 0,
      notes: ["turn_local_compaction_disabled"],
    };
  }

  // Find all reads in the context
  const reads: ReadInfo[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const meta = asObject(segment.metadata);
    const tool = normalizeToolName(meta);
    if (tool !== "read" && tool !== "exec") continue;
    const dataKey = extractDataKey(meta);
    if (!dataKey) continue;

    reads.push({
      index: i,
      segmentId: segment.id,
      toolName: tool,
      dataKey,
      text: segment.text,
    });
  }

  // Find all writes in the context
  const writes: WriteInfo[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const meta = asObject(segment.metadata);
    const tool = normalizeToolName(meta);
    if (tool !== "write" && tool !== "edit") continue;
    if (!isSuccessfulWriteLike(segment.text)) continue;

    writes.push({
      index: i,
      segmentId: segment.id,
      toolName: tool,
      text: segment.text,
    });
  }

  if (writes.length === 0 || reads.length === 0) {
    return {
      enabled: true,
      instructions: [],
      estimatedSavedChars: 0,
      notes: ["no_writes_or_reads_found"],
    };
  }

  // For each write, find reads that came before it
  const instructions: CompactionInstruction[] = [];
  const processedReadIds = new Set<string>();
  let estimatedSavedChars = 0;

  for (const write of writes) {
    for (const read of reads) {
      // Skip if read comes after write
      if (read.index > write.index) continue;

      // Skip if already processed
      if (processedReadIds.has(read.segmentId)) continue;

      // This read was "consumed" by this write
      estimatedSavedChars += read.text.length;

      instructions.push({
        strategy: "turn_local_evidence_compaction",
        segmentIds: [read.segmentId],
        confidence: 0.85,
        priority: 7,
        rationale: `${read.toolName} of "${read.dataKey}" was consumed by subsequent ${write.toolName} operation`,
        parameters: {
          consumedBy: {
            segmentId: write.segmentId,
            toolName: write.toolName,
            writePreview: write.text.slice(0, 200),
          },
          readDataKey: read.dataKey,
        },
      });

      processedReadIds.add(read.segmentId);
    }
  }

  return {
    enabled: true,
    instructions,
    estimatedSavedChars,
    notes: [
      `analyzed_segments=${segments.length}`,
      `reads_found=${reads.length}`,
      `writes_found=${writes.length}`,
      `consumed_reads=${instructions.length}`,
      `estimated_saved_chars=${estimatedSavedChars}`,
    ],
  };
}

// ============================================================================
// Combined Analyzer
// ============================================================================

/**
 * Combined analyzer that runs turn-local compaction analysis.
 */
export function analyzeCompaction(
  segments: ContextSegment[],
  config: {
    turnLocal?: TurnLocalCompactionAnalyzerConfig;
  } = {},
): CompactionDecision {
  const turnLocalDecision = analyzeTurnLocalCompaction(segments, config.turnLocal);

  return {
    enabled: true,
    instructions: turnLocalDecision.instructions.sort((a, b) => b.priority - a.priority),
    estimatedSavedChars: turnLocalDecision.estimatedSavedChars,
    notes: turnLocalDecision.notes,
  };
}
