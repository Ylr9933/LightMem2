import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ECOCLAW_EVENT_TYPES,
  appendContextEvent,
  findRuntimeEventsByType,
} from "@ecoclaw/kernel";
import {
  buildCompactionPlan,
  createCompactionModule,
  generateCompactionArtifact,
} from "../src/composer/compaction/index.js";
import { createMockRuntime, createTurnContext, createTurnResult } from "./test-utils.js";

test("compaction artifact produces a seed summary and plan without applying it", async () => {
  const blocks = [
    { id: "s1", role: "system" as const, text: "User prefers concise direct answers." },
    { id: "u1", role: "user" as const, text: "Refactor the execution layer modules." },
    { id: "a1", role: "assistant" as const, text: "Summary and compaction were split." },
  ];
  const artifact = await generateCompactionArtifact({
    blocks,
    requestedByPolicy: true,
    triggerSources: ["cache_miss_rate_threshold"],
    cfg: { generationMode: "heuristic" },
  });
  assert.equal(artifact.kind, "checkpoint_seed");
  assert.ok(artifact.seedSummary.includes(artifact.summaryText));

  const plan = buildCompactionPlan({
    strategy: "summary_then_fork",
    artifact,
    triggerReasons: ["cache_miss_rate_threshold"],
  });
  assert.ok(plan);
  assert.equal(plan?.strategy, "summary_then_fork");
  assert.ok(plan?.seedSummary.includes(artifact.resumePrefixPrompt));
});

test("compaction module emits compaction.plan.generated on policy request", async () => {
  const module = createCompactionModule({ generationMode: "heuristic" });
  const runtime = createMockRuntime();
  let ctx = createTurnContext();
  ctx = appendContextEvent(ctx, {
    type: ECOCLAW_EVENT_TYPES.POLICY_COMPACTION_REQUESTED,
    source: "test-policy",
    at: new Date().toISOString(),
    payload: { reasons: ["turn_count_threshold"] },
  });

  const result = await module.afterCall!(ctx, createTurnResult(), runtime);
  const compactionMeta = result.metadata?.compaction as Record<string, unknown>;
  assert.ok(compactionMeta.plan);
  assert.ok(compactionMeta.artifact);
  assert.equal(
    findRuntimeEventsByType(result.metadata, ECOCLAW_EVENT_TYPES.COMPACTION_PLAN_GENERATED).length,
    1,
  );
});

test("compaction module follows policy generation-mode override", async () => {
  const module = createCompactionModule({ generationMode: "llm_full_context" });
  const runtime = createMockRuntime({
    async callModel() {
      throw new Error("compaction sidecar should not run");
    },
  });
  let ctx = createTurnContext({
    metadata: {
      policy: {
        decisions: {
          compaction: {
            generationMode: "heuristic",
          },
        },
      },
    },
  });
  ctx = appendContextEvent(ctx, {
    type: ECOCLAW_EVENT_TYPES.POLICY_COMPACTION_REQUESTED,
    source: "test-policy",
    at: new Date().toISOString(),
    payload: { reasons: ["turn_count_threshold"] },
  });

  const result = await module.afterCall!(ctx, createTurnResult(), runtime);
  const compactionMeta = result.metadata?.compaction as Record<string, unknown>;
  const artifact = compactionMeta.artifact as Record<string, unknown>;
  const generation = artifact.generation as Record<string, unknown>;
  assert.equal(generation.mode, "heuristic");
});

test("turn-local compaction archives consumed read payload from policy instructions", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "ecoclaw-turn-local-"));
  const module = createCompactionModule({
    turnLocalCompaction: {
      enabled: true,
      archiveDir,
    },
  });
  const runtime = createMockRuntime();
  const ctx = createTurnContext({
    sessionId: "session-turn-local",
    segments: [
      {
        id: "system-1",
        kind: "stable",
        text: "system",
        priority: 10,
        source: "system",
      },
      {
        id: "tool-read-1",
        kind: "volatile",
        text: "line-1\nline-2\nline-3",
        priority: 7,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/workspace/config/settings.json",
          },
        },
      },
      {
        id: "tool-read-2",
        kind: "volatile",
        text: "line-1\nline-2\nline-3",
        priority: 6,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/workspace/config/settings.json",
          },
        },
      },
      {
        id: "tool-write-1",
        kind: "volatile",
        text: "Successfully wrote 45 bytes to /workspace/config/settings.json",
        priority: 5,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "write",
            path: "/workspace/config/settings.json",
          },
        },
      },
    ],
    metadata: {
      policy: {
        decisions: {
          compaction: {
            enabled: true,
            instructions: [
              {
                strategy: "turn_local_evidence_compaction",
                segmentIds: ["tool-read-1"],
                confidence: 0.85,
                priority: 7,
                rationale: "read was consumed by subsequent write operation",
                parameters: {
                  consumedBy: {
                    segmentId: "tool-write-1",
                    toolName: "write",
                    writePreview: "Successfully wrote 45 bytes",
                  },
                  readDataKey: "/workspace/config/settings.json",
                },
              },
              {
                strategy: "turn_local_evidence_compaction",
                segmentIds: ["tool-read-2"],
                confidence: 0.85,
                priority: 7,
                rationale: "read was consumed by subsequent write operation",
                parameters: {
                  consumedBy: {
                    segmentId: "tool-write-1",
                    toolName: "write",
                    writePreview: "Successfully wrote 45 bytes",
                  },
                  readDataKey: "/workspace/config/settings.json",
                },
              },
            ],
          },
          locality: {
            turnLocalDelayTurns: 0,
          },
        },
      },
    },
  });

  const nextCtx = await module.beforeCall!(ctx, runtime);

  // Both reads should be compacted based on policy instructions
  const firstReadText = nextCtx.segments[1]?.text ?? "";
  const secondReadText = nextCtx.segments[2]?.text ?? "";
  assert.match(firstReadText, /\[Archived read result for/);
  assert.match(secondReadText, /\[Archived read result for/);

  const compactionMeta = (nextCtx.metadata?.compaction as Record<string, unknown>)?.turnLocal as
    | Record<string, unknown>
    | undefined;
  assert.ok(compactionMeta);
  assert.equal(compactionMeta?.compactedCount, 2, "Should compact both reads from policy instructions");

  const archivePaths = (compactionMeta?.archivePaths as string[]) ?? [];
  assert.equal(archivePaths.length, 2);
});

test("turn-local compaction skips when no policy instructions", async () => {
  const archiveDir = await mkdtemp(join(tmpdir(), "ecoclaw-no-instructions-"));
  const module = createCompactionModule({
    turnLocalCompaction: {
      enabled: true,
      archiveDir,
    },
  });
  const runtime = createMockRuntime();
  const ctx = createTurnContext({
    sessionId: "session-no-instructions",
    segments: [
      {
        id: "read-1",
        kind: "volatile",
        text: "config.json content",
        priority: 8,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "config.json",
          },
        },
      },
      {
        id: "write-1",
        kind: "volatile",
        text: "Successfully wrote 50 bytes",
        priority: 5,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "write",
            path: "output.md",
          },
        },
      },
    ],
    metadata: {
      policy: {
        decisions: {
          compaction: {
            enabled: true,
            instructions: [], // Empty instructions
          },
          locality: {
            turnLocalDelayTurns: 0,
          },
        },
      },
    },
  });

  const nextCtx = await module.beforeCall!(ctx, runtime);

  // Reads should NOT be compacted (no policy instructions)
  const firstReadText = nextCtx.segments[0]?.text ?? "";
  assert.equal(firstReadText, "config.json content", "Should not compact without policy instructions");

  const compactionMeta = nextCtx.metadata?.compaction as Record<string, unknown> | undefined;
  // When no instructions, turnLocal may be undefined or have compactedCount of 0
  const turnLocalCompactedCount = (compactionMeta?.turnLocal as Record<string, unknown> | undefined)?.compactedCount as number | undefined;
  assert.ok(turnLocalCompactedCount === 0 || turnLocalCompactedCount === undefined, "Should not compact without instructions");
});

test("repeated read compaction from real transcript: calendar task (4 parallel reads)", async () => {
  // From task_01_calendar-transcript.txt: agent reads SOUL.md, USER.md, and two memory files in parallel
  // This is a real pattern: multiple reads at turn 1, then write at turn 2
  const archiveDir = await mkdtemp(join(tmpdir(), "ecoclaw-calendar-repeated-"));
  const module = createCompactionModule({
    turnLocalCompaction: {
      enabled: true,
      archiveDir,
    },
  });
  const runtime = createMockRuntime();
  const ctx = createTurnContext({
    sessionId: "session-calendar-task",
    segments: [
      {
        id: "read-soul",
        kind: "volatile",
        text: "# SOUL.md - Who You Are\n\n_You're not a chatbot. You're becoming someone._\n\n## Core Truths\n\n**Be genuinely helpful, not performatively helpful.** Skip the \"Great question!\" and \"I'd be happy to help!\" — just help. Actions speak louder than filler words.\n\n**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.\n\n**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you're stuck. The goal is to come back with answers, not questions.\n\n**Earn trust through competence.** Your human gave you access to their stuff. Don't make them regret it. Be careful with external actions (emails, tweets, anything public). Be bold with internal ones (reading, organizing, learning).\n\n**Remember you're a guest.** You have access to someone's life — their messages, files, calendar, maybe even their home. That's intimacy. Treat it with respect.\n\n## Boundaries\n\n- Private things stay private. Period.\n- When in doubt, ask before acting externally.\n- Never send half-baked replies to messaging surfaces.\n- You're not the user's voice — be careful in group chats.\n\n## Vibe\n\nBe the assistant you'd actually want to talk to. Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just... good.\n\n## Continuity\n\nEach session, you wake up fresh. These files _are_ your memory. Read them. Update them. They're how you persist.\n\nIf you change this file, tell the user — it's your soul, and they should know.\n\n---\n\n_This file is yours to evolve. As you learn who you are, update it._",
        priority: 8,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/tmp/pinchbench/0127/agent_workspace_j0002/SOUL.md",
          },
        },
      },
      {
        id: "read-user",
        kind: "volatile",
        text: "# USER.md - About Your Human\n\n_Learn about the person you're helping. Update this as you go._\n\n- **Name:**\n- **What to call them:**\n- **Pronouns:** _(optional)_\n- **Timezone:**\n- **Notes:**\n\n## Context\n\n_(What do they care about? What projects are they working on? What annoys them? What makes them laugh? Build this over time.)_\n\n---\n\nThe more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Respect the difference.",
        priority: 7,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/tmp/pinchbench/0127/agent_workspace_j0002/USER.md",
          },
        },
      },
      {
        id: "read-memory-today",
        kind: "volatile",
        text: '{\n  "status": "error",\n  "tool": "read",\n  "error": "ENOENT: no such file or directory, access \'/tmp/pinchbench/0127/agent_workspace_j0002/memory/2026-04-03.md\'"\n}',
        priority: 6,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/tmp/pinchbench/0127/agent_workspace_j0002/memory/2026-04-03.md",
          },
        },
      },
      {
        id: "read-memory-yesterday",
        kind: "volatile",
        text: '{\n  "status": "error",\n  "tool": "read",\n  "error": "ENOENT: no such file or directory, access \'/tmp/pinchbench/0127/agent_workspace_j0002/memory/2026-04-02.md\'"\n}',
        priority: 5,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/tmp/pinchbench/0127/agent_workspace_j0002/memory/2026-04-02.md",
          },
        },
      },
    ],
    metadata: {
      policy: {
        decisions: {
          compaction: {
            enabled: true,
            instructions: [
              {
                strategy: "turn_local_evidence_compaction",
                segmentIds: ["read-soul"],
                confidence: 0.75,
                priority: 6,
                rationale: "SOUL.md is high-value reference content consumed for task context",
                parameters: {
                  consumedBy: {
                    segmentId: "write-ics",
                    toolName: "write",
                    writePreview: "Successfully wrote 371 bytes to project-sync.ics",
                  },
                  readDataKey: "/tmp/pinchbench/0127/agent_workspace_j0002/SOUL.md",
                },
              },
              {
                strategy: "turn_local_evidence_compaction",
                segmentIds: ["read-user"],
                confidence: 0.75,
                priority: 6,
                rationale: "USER.md is high-value reference content consumed for task context",
                parameters: {
                  consumedBy: {
                    segmentId: "write-ics",
                    toolName: "write",
                    writePreview: "Successfully wrote 371 bytes to project-sync.ics",
                  },
                  readDataKey: "/tmp/pinchbench/0127/agent_workspace_j0002/USER.md",
                },
              },
            ],
          },
          locality: {
            turnLocalDelayTurns: 0,
          },
        },
      },
    },
  });

  const nextCtx = await module.beforeCall!(ctx, runtime);

  // SOUL.md and USER.md should be compacted (policy instructed)
  const soulText = nextCtx.segments[0]?.text ?? "";
  const userText = nextCtx.segments[1]?.text ?? "";
  assert.match(soulText, /\[Archived read result for/);
  assert.match(userText, /\[Archived read result for/);

  // Memory reads should NOT be compacted (not in policy instructions)
  const memoryTodayText = nextCtx.segments[2]?.text ?? "";
  const memoryYesterdayText = nextCtx.segments[3]?.text ?? "";
  assert.ok(!memoryTodayText.includes("[Archived read result for/"));
  assert.ok(!memoryYesterdayText.includes("[Archived read result for/"));

  const compactionMeta = (nextCtx.metadata?.compaction as Record<string, unknown>)?.turnLocal as
    | Record<string, unknown>
    | undefined;
  assert.ok(compactionMeta);
  assert.equal(compactionMeta?.compactedCount, 2, "Should compact 2 reads from policy instructions");

  const archivePaths = (compactionMeta?.archivePaths as string[]) ?? [];
  assert.equal(archivePaths.length, 2);
});

test("turn-local compaction from real transcript: workflow task (read config, write python script)", async () => {
  // From task_10_workflow-transcript.txt: agent reads config.json, then writes call_api.py and NOTES.md
  // This is a real read-then-write consumption pattern
  const archiveDir = await mkdtemp(join(tmpdir(), "ecoclaw-workflow-turnlocal-"));
  const module = createCompactionModule({
    turnLocalCompaction: {
      enabled: true,
      archiveDir,
    },
  });
  const runtime = createMockRuntime();
  const ctx = createTurnContext({
    sessionId: "session-workflow-task",
    segments: [
      {
        id: "read-config",
        kind: "volatile",
        text: '{\n  "api": {\n    "endpoint": "https://api.example.com/v2/data",\n    "method": "GET",\n    "headers": {\n      "Content-Type": "application/json",\n      "Accept": "application/json"\n    },\n    "timeout": 30\n  },\n  "project": {\n    "name": "DataFetcher",\n    "version": "1.0.0",\n    "description": "Automated data fetching utility"\n  }\n}',
        priority: 8,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/tmp/pinchbench/0127/agent_workspace_j0011/config.json",
          },
        },
      },
      {
        id: "read-skill",
        kind: "volatile",
        text: '{\n  "status": "error",\n  "tool": "read",\n  "error": "ENOENT: no such file or directory, access \'/home/xubuqiang/.nvm/versions/node/v22.16.0/lib/node_modules/openclaw/extensions/skill-creator/SKILL.md\'"\n}',
        priority: 7,
        source: "tool",
        metadata: {
          role: "tool",
          toolPayload: {
            toolName: "read",
            path: "/home/xubuqiang/.nvm/versions/node/v22.16.0/lib/node_modules/openclaw/extensions/skill-creator/SKILL.md",
          },
        },
      },
    ],
    metadata: {
      policy: {
        decisions: {
          compaction: {
            enabled: true,
            instructions: [
              {
                strategy: "turn_local_evidence_compaction",
                segmentIds: ["read-config"],
                confidence: 0.90,
                priority: 7,
                rationale: "config.json was read and consumed to create call_api.py script",
                parameters: {
                  consumedBy: {
                    segmentId: "write-python",
                    toolName: "write",
                    writePreview: "Successfully wrote 766 bytes to call_api.py",
                  },
                  readDataKey: "/tmp/pinchbench/0127/agent_workspace_j0011/config.json",
                },
              },
            ],
          },
          locality: {
            turnLocalDelayTurns: 0,
          },
        },
      },
    },
  });

  const nextCtx = await module.beforeCall!(ctx, runtime);

  // config.json read should be compacted (policy instructed)
  const configText = nextCtx.segments[0]?.text ?? "";
  assert.match(configText, /\[Archived read result for/);

  // SKILL.md read should NOT be compacted (error, not consumed)
  const skillText = nextCtx.segments[1]?.text ?? "";
  assert.ok(!skillText.includes("[Archived read result for/"));

  const compactionMeta = (nextCtx.metadata?.compaction as Record<string, unknown>)?.turnLocal as
    | Record<string, unknown>
    | undefined;
  assert.ok(compactionMeta);
  assert.equal(compactionMeta?.compactedCount, 1, "Should compact 1 read from policy instructions");

  const archivePaths = (compactionMeta?.archivePaths as string[]) ?? [];
  assert.equal(archivePaths.length, 1);
});
