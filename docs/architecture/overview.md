# Architecture Overview

## 3-Layer Architecture

```
transcript (raw event source, bottom layer)
    ↓
raw semantic turn (按 user-message boundary切成 turn)
    ↓
canonical (transcript-derived durable rewritten history)
```

- **Transcript**: Raw event source, bottom layer
- **Raw semantic turn**: A group of messages bounded by user-message boundaries
- **Canonical**: Durable rewritten history derived from transcript

## Key Distinctions

- `turn` ≠ `transcript message` (turn is a group, transcript is message-level)
- `seenMessageIds`: transcript ingestion ledger - records which transcript messages have been absorbed into canonical, never deleted on eviction
- `canonical.messages`: current durable history view - can be modified by eviction

## Recovery vs Reduction vs Eviction

Two different mechanisms:
- **Recovery**: Should NOT go through reduction again, but can be evicted with whole task
- **Eviction/Reduction**: Task-level eviction replaces whole task blocks with stubs

## eviction semantics

- eviction modifies `canonical.messages` but must NOT remove IDs from `seenMessageIds` ledger
- `transcriptMessageStableId()` uses transcript top-level `id` or fallback hash (role, toolCallId, toolName, timestamp, normalizedContent)

## Current Module Structure

- `packages/layers/decision/` - Policy decisions
- `packages/openclaw-plugin/src/execution/` - Plugin-local execution helpers (reduction, passes, archive-recovery)
- `packages/layers/history/` - Registry and raw semantic turn persistence
- `packages/openclaw-plugin/` - Plugin implementation

Related architecture notes:

- [canonical-design.md](./canonical-design.md)
- [plugin-semantic-grouping.md](./plugin-semantic-grouping.md)
- [plugin-refactor-status.md](./plugin-refactor-status.md)
