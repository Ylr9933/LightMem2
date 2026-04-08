import type { ApiFamily, RuntimeTurnContext } from "@ecoclaw/kernel";

export const ROUTING_TIERS = ["simple", "standard", "complex", "reasoning"] as const;
export type RoutingTier = (typeof ROUTING_TIERS)[number];

export type RoutingFeatures = {
  apiFamily: ApiFamily;
  promptChars: number;
  promptWords: number;
  hasCodeIntent: boolean;
  hasReasoningIntent: boolean;
  hasToolIntent: boolean;
  segmentCount: number;
  stableSegmentCount: number;
};

export type RoutingDecision = {
  tier: RoutingTier;
  reason: string;
  score?: number;
  confidence?: number;
  provider?: string;
  model?: string;
  fallbackModels?: string[];
  metadata?: Record<string, unknown>;
};

export type TierRouteConfig = {
  provider?: string;
  model?: string;
  fallbackModels?: string[];
};

export type LlmRouter = {
  resolve(ctx: RuntimeTurnContext, features: RoutingFeatures): Promise<RoutingDecision> | RoutingDecision;
};

export type TaskRouterConfig = {
  enabled?: boolean;
  defaultTier?: RoutingTier;
  smallTaskTokenBudget?: number;
  router?: LlmRouter | ((ctx: RuntimeTurnContext, features: RoutingFeatures) => Promise<RoutingDecision> | RoutingDecision);
  tierRoutes?: Partial<Record<RoutingTier, TierRouteConfig>>;
};

// ============================================================================
// Reduction Decision Types
// ============================================================================

/**
 * Reduction strategy types for different compression approaches
 */
export type ReductionStrategy =
  | "repeated_read_dedup"      // Remove duplicate reads of same content/path
  | "exec_output_truncation"   // Truncate large exec/tool outputs
  | "tool_payload_trim"        // Trim tool payload fields
  | "html_slimming"            // Compress HTML content
  | "format_slimming"          // Remove formatting overhead
  | "semantic_compression"     // Semantic compression (LLMLingua2, etc.)
  | "format_cleaning"          // Clean whitespace, HTML comments, full-width chars
  | "path_truncation"          // Truncate long file paths in output
  | "image_downsample"         // Downsample large base64 images
  | "line_number_strip"        // Strip line number prefixes from read output
  | "agents_startup_optimization"  // Modify AGENTS.md to prevent redundant reads
  | (string & {});              // Extensible

/**
 * Instruction for a single reduction operation
 */
export type ReductionInstruction = {
  /** The strategy to use for this reduction */
  strategy: ReductionStrategy;
  /** Target segment IDs to reduce */
  segmentIds: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Priority for ordering (higher = process first) */
  priority: number;
  /** Human-readable rationale for the decision */
  rationale: string;
  /** Strategy-specific parameters */
  parameters?: Record<string, unknown>;
};

/**
 * Decision output from Policy to Reduction module
 */
export type ReductionDecision = {
  enabled: boolean;
  /** Instructions for reduction operations */
  instructions: ReductionInstruction[];
  /** Total chars that could be saved by following instructions */
  estimatedSavedChars: number;
  /** Notes about the decision */
  notes?: string[];
};

// ============================================================================
// Compaction Decision Types
// ============================================================================

/**
 * Compaction strategy types for context window management
 */
export type CompactionStrategy =
  | "turn_local_evidence_compaction"  // Compact reads consumed by writes
  | "checkpoint_summary"              // Generate summary for checkpoint
  | (string & {});                     // Extensible

/**
 * Instruction for a single compaction operation
 */
export type CompactionInstruction = {
  /** The strategy to use for this compaction */
  strategy: CompactionStrategy;
  /** Target segment IDs to compact */
  segmentIds: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Priority for ordering (higher = process first) */
  priority: number;
  /** Human-readable rationale for the decision */
  rationale: string;
  /** Strategy-specific parameters */
  parameters?: Record<string, unknown>;
};

/**
 * Decision output from Policy to Compaction module
 */
export type CompactionDecision = {
  enabled: boolean;
  /** Instructions for compaction operations */
  instructions: CompactionInstruction[];
  /** Total chars that could be saved by following instructions */
  estimatedSavedChars: number;
  /** Notes about the decision */
  notes?: string[];
};
