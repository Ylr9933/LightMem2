/* eslint-disable @typescript-eslint/no-explicit-any */
import { prependTextToContent } from "../request-preprocessing/root-prompt-stabilizer.js";
import { formatProceduralMemoryInjection, createLocalProceduralMemoryBackend, createPromptingDistiller, runProceduralMemoryBatch } from "@tokenpilot/memory";
import { loadSessionTaskRegistry } from "@tokenpilot/history";

function extractTaskObjective(registry: Awaited<ReturnType<typeof loadSessionTaskRegistry>>, taskId: string): string {
  return String(registry.tasks[taskId]?.objective ?? "").trim();
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function embeddingProviderFromConfig(cfg: any):
  | {
      baseUrl: string;
      apiKey: string;
      model: string;
      queryInstruction?: string;
    }
  | undefined {
  const embedding = cfg?.memory?.embedding;
  if (!embedding || embedding.enabled !== true) return undefined;
  const baseUrl = String(embedding.baseUrl ?? "").trim();
  const apiKey = String(embedding.apiKey ?? "").trim();
  const model = String(embedding.model ?? "").trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return {
    baseUrl,
    apiKey,
    model,
    queryInstruction: typeof embedding.queryInstruction === "string" ? embedding.queryInstruction.trim() : undefined,
  };
}

function distillProviderFromConfig(cfg: any):
  | {
      baseUrl: string;
      apiKey: string;
      model: string;
      requestTimeoutMs?: number;
    }
  | undefined {
  const provider = cfg?.memory?.distillProvider;
  if (!provider) return undefined;
  const baseUrl = String(provider.baseUrl ?? "").trim();
  const apiKey = String(provider.apiKey ?? "").trim();
  const model = String(provider.model ?? "").trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  return {
    baseUrl,
    apiKey,
    model,
    requestTimeoutMs: typeof provider.requestTimeoutMs === "number" ? provider.requestTimeoutMs : undefined,
  };
}

function createConfiguredDistiller(cfg: any) {
  const provider = distillProviderFromConfig(cfg);
  if (!provider) return undefined;
  const kind = String(cfg?.memory?.distillerType ?? "prompting").trim();
  if (kind === "prompting") return createPromptingDistiller(provider);
  if (kind === "autoskill") throw new Error("procedural_memory_distiller_not_implemented:autoskill");
  if (kind === "ctx2skill") throw new Error("procedural_memory_distiller_not_implemented:ctx2skill");
  throw new Error(`procedural_memory_distiller_unknown:${kind}`);
}

function collectArchivePaths(state: any, taskId: string, helpers: any): string[] {
  const out: string[] = [];
  const messages = Array.isArray(state?.messages) ? state.messages : [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const message = raw as Record<string, unknown>;
    const details = helpers.asRecord(message.details);
    const contextSafe = helpers.asRecord(details?.contextSafe);
    const taskIds = Array.isArray(contextSafe?.taskIds)
      ? contextSafe.taskIds.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (!taskIds.includes(taskId)) continue;
    const eviction = helpers.asRecord(contextSafe?.eviction);
    const archivePath = typeof eviction?.archivePath === "string" ? eviction.archivePath.trim() : "";
    if (archivePath) out.push(archivePath);
  }
  return unique(out);
}

export async function enqueueEvictedTasksForProceduralMemory(params: {
  cfg: any;
  sessionId: string;
  state: any;
  appliedTaskIds: string[];
  helpers: any;
  logger: any;
}): Promise<{ enqueued: number; processed: number; produced: number }> {
  if (!params.cfg.memory.enabled || !params.cfg.memory.autoDistill || params.appliedTaskIds.length === 0) {
    return { enqueued: 0, processed: 0, produced: 0 };
  }
  const backend = createLocalProceduralMemoryBackend(params.cfg.stateDir, {
    embeddingProvider: embeddingProviderFromConfig(params.cfg),
    distillProvider: distillProviderFromConfig(params.cfg),
  });
  const registry = await loadSessionTaskRegistry(params.cfg.stateDir, params.sessionId);
  const payloads: Array<{
    sessionId: string;
    taskId: string;
    archivePath: string;
    archiveSourceLabel: string;
    archiveDigest?: string;
    objective: string;
    completionEvidence: string[];
    unresolvedQuestions: string[];
    turnAbsIds: string[];
  }> = [];
  for (const taskId of unique(params.appliedTaskIds)) {
    const task = registry.tasks[taskId];
    if (!task) continue;
    const archivePaths = collectArchivePaths(params.state, taskId, params.helpers);
    for (const archivePath of archivePaths) {
      payloads.push({
        sessionId: params.sessionId,
        taskId,
        archivePath,
        archiveSourceLabel: "canonical_task_eviction",
        objective: extractTaskObjective(registry, taskId),
        completionEvidence: [...task.completionEvidence],
        unresolvedQuestions: [...task.unresolvedQuestions],
        turnAbsIds: [...task.span.supportingTurnAbsIds],
      });
    }
  }
  const enqueued = await backend.enqueue(payloads);
  let batch = { drained: 0, produced: 0, failed: 0 };
  const distillerType = String(params.cfg?.memory?.distillerType ?? "prompting").trim();
  const distiller = createConfiguredDistiller(params.cfg);
  let distillerStatus = "disabled";
  if (distiller) {
    try {
      distillerStatus = "active";
      batch = await runProceduralMemoryBatch({
      backend,
      batchSize: params.cfg.memory.batchSize,
      distiller,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      distillerStatus = "setup_failed";
      params.logger.warn?.(
        `[plugin-runtime/procedural-memory] session=${params.sessionId} distiller=${distillerType} distiller_setup_failed reason=${reason}`,
      );
    }
  } else if (distillProviderFromConfig(params.cfg)) {
    distillerStatus = "provider_missing_or_disabled";
  }
  if (enqueued > 0 || batch.drained > 0 || distillerStatus !== "active") {
    await params.helpers.appendTaskStateTrace(params.cfg.stateDir, {
      stage: "procedural_memory_batch",
      sessionId: params.sessionId,
      distillerType,
      distillerStatus,
      enqueued,
      processed: batch.drained,
      produced: batch.produced,
      failed: batch.failed,
      taskIds: unique(params.appliedTaskIds),
    });
    params.logger.info(
      `[plugin-runtime/procedural-memory] session=${params.sessionId} distiller=${distillerType} status=${distillerStatus} enqueued=${enqueued} processed=${batch.drained} produced=${batch.produced} failed=${batch.failed}`,
    );
  }
  return { enqueued, processed: batch.drained, produced: batch.produced };
}

export async function injectProceduralMemoryHints(params: {
  cfg: any;
  sessionId: string;
  payload: any;
  helpers: any;
}): Promise<{ injected: boolean; hitCount: number }> {
  if (!params.cfg.memory.enabled || params.cfg.memory.topK <= 0) {
    return { injected: false, hitCount: 0 };
  }
  const registry = await loadSessionTaskRegistry(params.cfg.stateDir, params.sessionId);
  const activeTaskId = registry.activeTaskIds[registry.activeTaskIds.length - 1] ?? "";
  const objectiveFromRegistry = activeTaskId ? extractTaskObjective(registry, activeTaskId) : "";
  const objectiveFromUser = params.helpers.extractInputText(
    Array.isArray(params.payload?.input)
      ? params.payload.input.filter((item: any) => item && typeof item === "object" && String(item.role ?? "") === "user")
      : [],
  ).trim();
  const objective = objectiveFromRegistry || objectiveFromUser;
  if (!objective) return { injected: false, hitCount: 0 };

  const backend = createLocalProceduralMemoryBackend(params.cfg.stateDir, {
    embeddingProvider: embeddingProviderFromConfig(params.cfg),
    distillProvider: distillProviderFromConfig(params.cfg),
  });
  const hits = await backend.retrieve({
    sessionId: params.sessionId,
    objective,
    topK: params.cfg.memory.topK,
  });
  if (hits.length === 0) return { injected: false, hitCount: 0 };

  const text = formatProceduralMemoryInjection(hits);
  if (!text) return { injected: false, hitCount: 0 };

  if (!Array.isArray(params.payload.input)) params.payload.input = [];
  if (params.cfg.memory.injectAsSystemHint) {
    params.payload.input.unshift({
      role: "system",
      content: text,
    });
  } else {
    const userIndex = params.payload.input.findIndex((item: any) => item && typeof item === "object" && String(item.role ?? "") === "user");
    if (userIndex >= 0) {
      const userItem = params.payload.input[userIndex];
      params.payload.input[userIndex] = {
        ...userItem,
        role: "user",
        content: prependTextToContent(userItem?.content, text),
      };
    } else {
      params.payload.input.unshift({
        role: "user",
        content: text,
      });
    }
  }
  await params.helpers.appendTaskStateTrace(params.cfg.stateDir, {
    stage: "procedural_memory_injected",
    sessionId: params.sessionId,
    distillerType: String(params.cfg?.memory?.distillerType ?? "prompting").trim(),
    activeTaskId,
    objective,
    hitCount: hits.length,
    skillIds: hits.map((hit) => hit.skill.skillId),
  });
  return { injected: true, hitCount: hits.length };
}
