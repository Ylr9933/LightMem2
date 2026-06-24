import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createCodexCliBridge } from "../../../products/cli/src/hosts/codex.js";
import { loadTokenPilotCodexConfig, defaultTokenPilotConfigPath } from "../src/config.js";

test("codex cli bridge exposes only the supported Codex command surface", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lightmem2-codex-bridge-"));
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const { handleCommand } = createCodexCliBridge({ host: "codex" });

    const status = await handleCommand({ args: "status" });
    assert.match(status.text, /TokenPilot Codex status:/);
    assert.doesNotMatch(status.text, /lifecycle eviction/i);
    assert.doesNotMatch(status.text, /task-state estimator/i);

    const reduction = await handleCommand({ args: "reduction off" });
    assert.equal(reduction.text, "✅ Observation Reduction disabled");

    const reductionStatus = await handleCommand({ args: "reduction status" });
    assert.match(reductionStatus.text, /Observation Reduction \(Codex\):/);
    assert.doesNotMatch(reductionStatus.text, /formatSlimming/);

    const stabilizer = await handleCommand({ args: "stabilizer target user" });
    assert.equal(stabilizer.text, "✅ hooks.dynamicContextTarget = user");

    const doctor = await handleCommand({ args: "doctor" });
    assert.match(doctor.text, /TokenPilot Codex doctor:/);

    const visual = await handleCommand({ args: "visual" });
    assert.equal(visual.text, "Codex visual is not implemented yet.");

    const report = await handleCommand({ args: "report" });
    assert.equal(report.text, "No TokenPilot session stats yet.");

    const unsupportedSettings = await handleCommand({ args: "settings details on" });
    assert.equal(unsupportedSettings.text, "Codex does not expose shared runtime settings yet.");

    const unsupportedEviction = await handleCommand({ args: "eviction on" });
    assert.equal(unsupportedEviction.text, "Codex lifecycle eviction controls are not supported.");

    const aggressiveMode = await handleCommand({ args: "mode aggressive" });
    assert.equal(aggressiveMode.text, "Codex does not support lifecycle eviction mode. Use `mode normal` or `mode conservative`.");

    const unsupportedHook = await handleCommand({ args: "stabilizer hook on" });
    assert.equal(unsupportedHook.text, "Codex currently supports only `stabilizer on|off` and `stabilizer target <developer|user>`.");

    const unsupportedReductionPass = await handleCommand({ args: "reduction pass formatSlimming on" });
    assert.equal(unsupportedReductionPass.text, "Codex reduction supports only these passes: readStateCompaction, toolPayloadTrim, htmlSlimming, execOutputTruncation, agentsStartupOptimization");
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("codex cli bridge persists only supported settings across reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lightmem2-codex-bridge-persist-"));
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const bridge = createCodexCliBridge({ host: "codex" });

    const reduction = await bridge.handleCommand({ args: "reduction off" });
    assert.equal(reduction.text, "✅ Observation Reduction disabled");

    const target = await bridge.handleCommand({ args: "stabilizer target user" });
    assert.equal(target.text, "✅ hooks.dynamicContextTarget = user");

    const unsupported = await bridge.handleCommand({ args: "settings details on" });
    assert.equal(unsupported.text, "Codex does not expose shared runtime settings yet.");

    const reloaded = await loadTokenPilotCodexConfig(defaultTokenPilotConfigPath());
    assert.equal(reloaded.modules.reduction, false);
    assert.equal(reloaded.hooks.dynamicContextTarget, "user");
    assert.equal("ux" in (reloaded as unknown as Record<string, unknown>), false);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("codex mode writes only codex-supported fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lightmem2-codex-bridge-mode-"));
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const bridge = createCodexCliBridge({ host: "codex" });

    const result = await bridge.handleCommand({ args: "mode conservative" });
    assert.equal(result.text, "✅ Runtime mode = conservative");

    const reloaded = await loadTokenPilotCodexConfig(defaultTokenPilotConfigPath());
    assert.equal(reloaded.enabled, true);
    assert.equal(reloaded.modules.stabilizer, true);
    assert.equal(reloaded.modules.reduction, true);
    assert.equal(reloaded.reduction.triggerMinChars, 4000);
    assert.equal(reloaded.reduction.maxToolChars, 1800);

    const record = reloaded as unknown as Record<string, unknown>;
    assert.equal("taskStateEstimator" in record, false);
    assert.equal("eviction" in record, false);
    const modules = record.modules as Record<string, unknown>;
    assert.equal("policy" in modules, false);
    assert.equal("eviction" in modules, false);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("codex config normalization strips unsupported reduction pass options", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lightmem2-codex-bridge-sanitize-"));
  const originalHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    const bridge = createCodexCliBridge({ host: "codex" });
    const current = await loadTokenPilotCodexConfig(defaultTokenPilotConfigPath());
    await bridge.bridge.writeConfig({
      ...current,
      reduction: {
        ...current.reduction,
        passOptions: {
          ...current.reduction.passOptions,
          formatSlimming: { enabled: true },
          pathTruncation: { enabled: true },
          htmlSlimming: { preserveTables: true },
        },
      },
    });

    const reloaded = await loadTokenPilotCodexConfig(defaultTokenPilotConfigPath());
    assert.equal("formatSlimming" in reloaded.reduction.passOptions, false);
    assert.equal("pathTruncation" in reloaded.reduction.passOptions, false);
    assert.deepEqual(reloaded.reduction.passOptions.htmlSlimming, { preserveTables: true });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
