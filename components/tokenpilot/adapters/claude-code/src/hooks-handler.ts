#!/usr/bin/env node
import { defaultTokenPilotClaudeCodeConfigPath } from "./config.js";
import { processClaudeCodeHookEvent } from "./hook-runtime.js";

export async function readClaudeCodeHookStdinJson(): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

export async function runClaudeCodeHooksHandler(input: Record<string, unknown>, configPath?: string): Promise<void> {
  await processClaudeCodeHookEvent({
    input,
    configPath: configPath ?? process.env.TOKENPILOT_CLAUDE_CODE_CONFIG ?? defaultTokenPilotClaudeCodeConfigPath(),
  });
}

async function main() {
  const input = await readClaudeCodeHookStdinJson();
  const configPath = process.env.TOKENPILOT_CLAUDE_CODE_CONFIG ?? defaultTokenPilotClaudeCodeConfigPath();
  await runClaudeCodeHooksHandler(input, configPath);
}

if (
  process.argv[1]
  && /(^|\/)hooks-handler\.(ts|js)$/.test(process.argv[1])
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
