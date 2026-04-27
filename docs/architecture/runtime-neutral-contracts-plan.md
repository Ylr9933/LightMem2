# Runtime-Neutral Contracts Plan

## Goal

Define the minimum shared contracts needed to support multiple host runtimes
without cloning the whole method implementation.

Target host adapters:

- OpenClaw
- Hermes Agent
- OpenJiuwen

Target shared layers:

- `packages/kernel` for minimal shared contracts and primitives
- `packages/layers/history` for page-out / canonical domain logic
- `packages/runtime-core` for shared execution backends

## Design Rule

Use this split:

1. `kernel` holds the smallest host-neutral contracts
2. `layers/*` holds domain logic and domain objects
3. `runtime-core` holds reusable execution backends
4. host adapters translate runtime-native payloads into shared contracts

That means:

- adapters should know host hooks, sessions, tool registration, transcript file
  formats, and provider wiring
- shared packages should only know structured inputs and outputs

## Contract Buckets

### 1. Kernel Contracts

These should stay small, stable, and broadly reusable.

Recommended contents:

- `RuntimeMessage`
- `RuntimeToolCall`
- `RuntimeToolResult`
- `RuntimeSessionRef`
- `TranscriptTurn`
- `UsageSnapshot`
- `ContextSegment`
- `RuntimeBudget`

These belong in `packages/kernel` because they are:

- shared by adapters
- shared by `layers/*`
- shared by `runtime-core`

They should avoid:

- OpenClaw hook names
- OpenClaw transcript row formats
- provider-specific payload shapes

### 2. History / Page-Out Contracts

These belong with page-out domain logic and should eventually live beside
`layers/history`.

Recommended contracts:

- `CanonicalMessage`
- `CanonicalTaskBlock`
- `TaskAnchor`
- `CanonicalState`
- `PageOutCandidate`
- `PageOutDecision`
- `ContextRewritePlan`
- `EvictionReplacement`

These are not transport types. They are method-domain objects.

### 3. Page-In Contracts

These define the neutral inputs/outputs for recall and rehydration.

Recommended contracts:

- `PageInRequest`
- `PageInSourceRef`
- `PageInChunk`
- `PageInResult`
- `RecoveryPlan`

These should not know whether the host runtime uses a tool call, a special
message role, or a custom retrieval API.

### 4. Runtime-Core Execution Contracts

These are backend-oriented contracts used by reduction and recovery execution.

Recommended contracts:

- `ReductionPassInput`
- `ReductionPassOutput`
- `ReductionPipelineInput`
- `ReductionPipelineResult`
- `ArchiveLookupRequest`
- `ArchiveLookupResult`

These belong in `packages/runtime-core`, not `kernel`, because they are more
specialized and algorithm-facing.

## Adapter Translation Boundaries

### Request Preprocessing Boundary

Host adapter responsibility:

- read host request payload
- extract message content / tool results
- normalize into `RuntimeMessage[]` or reduction pipeline inputs

Shared responsibility:

- reduction planning
- reduction pass execution
- stable content transformation

### Page-Out Boundary

Host adapter responsibility:

- parse transcript source format
- repair malformed transcript rows
- resolve host session identity

Shared responsibility:

- build `TranscriptTurn`
- update canonical state
- plan eviction
- produce rewrite plan

### Page-In Boundary

Host adapter responsibility:

- expose a host-visible recovery mechanism
- map host tool/runtime responses back into shared result objects

Shared responsibility:

- choose what to reload
- plan recall / rehydration
- shape recovered content

## Recommended Extraction Order

### Phase 1: Stabilize Contracts

Before moving more files:

1. add kernel-level host-neutral message/session/turn contracts
2. add history/page-out domain contracts
3. add runtime-core reduction contracts

### Phase 2: Extract Canonical Domain Logic

After contracts exist:

1. move `canonical-state`
2. move `canonical-anchors`
3. move `canonical-rewrite`
4. move `canonical-eviction`

Target:

- `packages/layers/history`

### Phase 3: Split Mixed Request Preprocessing Modules

Do not move these wholesale:

- `stable-prefix.ts`
- `reduction-context.ts`
- `tool-results-persist.ts`

Instead split them into:

1. host-neutral planning/transformation
2. OpenClaw payload patching

### Phase 4: Validate With A Second Adapter

The boundary is only proven when a second runtime adapter can call the same
shared contracts without copying the OpenClaw logic.

## What Not To Do

Avoid these mistakes:

- do not put host transcript salvage into `kernel`
- do not put reduction execution backend into `layers/history`
- do not let `kernel` grow into a new general runtime framework again
- do not move host tool registration into shared packages

## Immediate Next Step

The next concrete step should be:

1. define kernel-level neutral transcript/session/message contracts
2. define page-out domain contracts for canonical rewrite / eviction
3. only then start moving `canonical-*` out of the OpenClaw adapter
