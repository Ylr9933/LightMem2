import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  normalizeTokenPilotClaudeCodeConfig,
  writeTokenPilotClaudeCodeConfig,
} from "../src/config.js";
import { runClaudeCodeHooksHandler } from "../src/hooks-handler.js";

test("hooks-handler entry function records Claude Code observability events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lightmem2-claude-hooks-handler-"));
  try {
    const stateDir = join(dir, "state");
    const configPath = join(dir, "tokenpilot.json");
    await writeTokenPilotClaudeCodeConfig(
      normalizeTokenPilotClaudeCodeConfig({
        stateDir,
      }),
      configPath,
    );

    await runClaudeCodeHooksHandler({
      hook_event_name: "PreToolUse",
      session_id: "sess-script-1",
      cwd: "/repo/script-demo",
      tool_name: "grep",
      tool_input: {
        pattern: "TODO",
      },
    }, configPath);

    const latest = JSON.parse(
      await readFile(join(stateDir, "session-state", "latest.json"), "utf8"),
    ) as { sessionId: string };
    assert.equal(latest.sessionId, "sess-script-1");

    const snapshot = JSON.parse(
      await readFile(join(stateDir, "session-state", "sessions", "sess-script-1.json"), "utf8"),
    ) as { lastHookEvent?: string; lastToolName?: string; workspaceHint?: string };
    assert.equal(snapshot.lastHookEvent, "PreToolUse");
    assert.equal(snapshot.lastToolName, "grep");
    assert.equal(snapshot.workspaceHint, "/repo/script-demo");

    const trace = await readFile(join(stateDir, "event-trace.jsonl"), "utf8");
    assert.match(trace, /claude_code_hook_pre_tool_use/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
