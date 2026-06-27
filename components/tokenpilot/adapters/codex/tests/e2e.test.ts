import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  assertProductSurfaceSmoke,
  assertRecoveryProtocolText,
  assertRecoveryRoundTrip,
  assertReductionMarkerText,
  createLongToolPayload,
  reserveUnusedPort,
  startMockJsonUpstream,
  withTempHome,
} from "@tokenpilot/host-adapter";
import { MEMORY_FAULT_RECOVER_TOOL_NAME, handleMcpRequest } from "../../../products/mcp/src/index.js";
import { createCodexCliBridge } from "../../../products/cli/src/hosts/codex.js";
import {
  defaultCodexConfigPath,
  defaultHooksConfigPath,
  defaultTokenPilotConfigPath,
  loadTokenPilotCodexConfig,
  normalizeTokenPilotCodexConfig,
  writeTokenPilotCodexConfig,
} from "../src/config.js";
import { installCodexTokenPilot } from "../src/install.js";
import { createConsoleLogger } from "../src/logger.js";
import { startCodexResponsesProxy } from "../src/proxy-runtime.js";

test("Codex host e2e wires install, proxy reduction, report/visual, and MCP recovery together", async () => {
  await withTempHome("lightmem2-codex-e2e-", async (homeDir) => {
    const proxyPort = await reserveUnusedPort();
    const stateDir = join(homeDir, ".codex", "tokenpilot-state", "tokenpilot");
    const codexConfigPath = defaultCodexConfigPath();
    const hooksConfigPath = defaultHooksConfigPath();
    const tokenPilotConfigPath = defaultTokenPilotConfigPath();
    const longToolPayload = createLongToolPayload();
    let runtime: Awaited<ReturnType<typeof startCodexResponsesProxy>> | undefined;

    const upstream = await startMockJsonUpstream({
      responseBody: {
        id: "resp_e2e_1",
        object: "response",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "done" }],
          },
        ],
      },
    });

    await mkdir(join(homeDir, ".codex"), { recursive: true });
    await writeTokenPilotCodexConfig(
      normalizeTokenPilotCodexConfig({
        proxyPort,
        stateDir,
        upstreamProvider: "OpenAI",
        hooks: {
          dynamicContextTarget: "user",
        },
        reduction: {
          triggerMinChars: 256,
          maxToolChars: 280,
          passes: {
            readStateCompaction: false,
            toolPayloadTrim: true,
            htmlSlimming: false,
            execOutputTruncation: true,
            agentsStartupOptimization: false,
          },
        },
      }),
      tokenPilotConfigPath,
    );

    await mkdir(join(homeDir, ".codex"), { recursive: true });
    await mkdir(join(homeDir, ".codex"), { recursive: true });
    await installCodexTokenPilot({
      codexConfigPath,
      hooksConfigPath,
      tokenPilotConfigPath,
    });

    const codexToml = [
      "model_provider = \"tokenpilot\"",
      "",
      "[model_providers.tokenpilot]",
      "name = \"TokenPilot\"",
      `base_url = ${JSON.stringify(`http://127.0.0.1:${proxyPort}/v1`)}`,
      "wire_api = \"responses\"",
      "requires_openai_auth = true",
      "",
      "[model_providers.OpenAI]",
      "name = \"OpenAI\"",
      `base_url = ${JSON.stringify(upstream.baseUrl)}`,
      "wire_api = \"responses\"",
      "requires_openai_auth = true",
      "",
      "[mcp_servers.tokenpilot_memory_fault_recover]",
      `command = ${JSON.stringify(process.execPath)}`,
      `args = [${JSON.stringify("/tmp/server.js")}]`,
      "",
      "[mcp_servers.tokenpilot_memory_fault_recover.env]",
      `TOKENPILOT_STATE_DIR = ${JSON.stringify(stateDir)}`,
      "",
    ].join("\n");
    await mkdir(join(homeDir, ".codex"), { recursive: true });
    await writeFile(codexConfigPath, codexToml, "utf8");

    const config = await loadTokenPilotCodexConfig(tokenPilotConfigPath);
    runtime = await startCodexResponsesProxy({
      config,
      logger: createConsoleLogger(false),
      codexConfigPath,
    });

    const response = await fetch(`${runtime.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "tokenpilot/gpt-5.4-mini",
        stream: false,
        instructions: "Your working directory is: /repo/demo\nRuntime: agent=agent-123 |\nBe precise.",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "summarize this tool output" },
            ],
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: longToolPayload,
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0]?.model, "gpt-5.4-mini");
    assert.match(String(upstream.requests[0]?.instructions ?? ""), /Your working directory is: \/repo\/demo/);
    assert.match(String(upstream.requests[0]?.instructions ?? ""), /Runtime: agent=agent-123 \|/);
    assertRecoveryProtocolText(String(upstream.requests[0]?.instructions ?? ""));

    const forwardedInput = upstream.requests[0]?.input as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(forwardedInput));
    const firstUser = forwardedInput[0];
    const firstBlocks = firstUser?.content as Array<Record<string, unknown>>;

    const reducedToolItem = forwardedInput[1];
    const reducedOutput = String(reducedToolItem?.output ?? "");
    assertReductionMarkerText(reducedOutput);
    await assertRecoveryRoundTrip({
      reducedText: reducedOutput,
      stateDir,
      async recover(dataKey) {
        const recovery = await handleMcpRequest(
          {
            id: 1,
            method: "tools/call",
            params: {
              name: MEMORY_FAULT_RECOVER_TOOL_NAME,
              arguments: {
                dataKey,
              },
            },
          },
          { stateDir },
        );
        const recoveryContent = recovery?.result?.content as Array<{ type: string; text: string }>;
        return {
          isError: recovery?.result?.isError === true,
          text: recoveryContent?.[0]?.text ?? "",
        };
      },
    });

    const { handleCommand } = createCodexCliBridge({ host: "codex" });

    await assertProductSurfaceSmoke({
      run(args) {
        return handleCommand({ args });
      },
      doctorPatterns: [
        /TokenPilot Codex doctor:/,
        /provider installed: yes/,
        /recovery MCP installed: yes/,
        /hooks installed: yes/,
        /proxy healthy: yes/,
      ],
      report: {
        unitLabel: "chars",
      },
      visual: {
        header: "TokenPilot Codex visual:",
        requiredPatterns: [
          /model: gpt-5.4-mini/,
          /response chain: resp_e2e_1/,
        ],
      },
    });

    await runtime?.close();
    await upstream.close();
  });
});
