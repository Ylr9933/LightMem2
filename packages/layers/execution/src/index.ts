// EcoClaw Execution Layer
//
// Organized into two tiers:
// - composer: High-level orchestration modules (Stabilizer, Compaction, Reduction)
// - atomic: Primitive operations used by composers (Summary, Semantic, Handoff, Passes)

export * from "./composer/index.js";
export * from "./atomic/index.js";
