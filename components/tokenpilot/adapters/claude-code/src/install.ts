import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveTokenPilotMcpServerSpec, type TokenPilotMcpServerSpec } from "@tokenpilot/mcp";
import {
  CLAUDE_TOOL_SEARCH_DEFAULT,
  CLAUDE_TOOL_SEARCH_ENV,
  defaultClaudeCodeMcpConfigPath,
  defaultClaudeCodeSettingsPath,
  defaultTokenPilotClaudeCodeConfigPath,
  loadTokenPilotClaudeCodeConfig,
  proxyBaseUrlForPort,
  writeTokenPilotClaudeCodeConfig,
} from "./config.js";

const CLAUDE_CODE_MCP_STARTUP_TIMEOUT_SEC = 90;
const CLAUDE_CODE_MCP_INSTALL_PROBE_TIMEOUT_MS = 15_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function adapterRootFromHere(): string {
  const moduleDir = __dirname;
  const fromDist = resolve(moduleDir, "..");
  if (existsSync(join(fromDist, "package.json"))) {
    return fromDist;
  }
  const fromSrc = resolve(moduleDir, "..");
  if (existsSync(join(fromSrc, "package.json"))) {
    return fromSrc;
  }
  return join(process.cwd(), "components", "tokenpilot", "adapters", "claude-code");
}

function shellQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function tokenPilotHookCommand(adapterRoot: string): string {
  const distHandler = resolve(adapterRoot, "dist", "hooks-handler.js");
  if (existsSync(distHandler)) {
    return `${shellQuote(process.execPath)} ${shellQuote(distHandler)}`;
  }
  const srcHandler = resolve(adapterRoot, "src", "hooks-handler.ts");
  return `${shellQuote(process.execPath)} --import tsx ${shellQuote(srcHandler)}`;
}

export function resolveClaudeCodeHookCommandForInstall(): string {
  return tokenPilotHookCommand(adapterRootFromHere());
}

export function resolveClaudeCodeMcpServerSpecForInstall(stateDir: string): TokenPilotMcpServerSpec {
  return resolveTokenPilotMcpServerSpec({
    stateDir,
  });
}

function isTokenPilotHookEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const record = entry as Record<string, unknown>;
  const command = record.command;
  return typeof command === "string" && command.includes("hooks-handler.");
}

function upsertHookGroup(groups: unknown, group: Record<string, unknown>): Record<string, unknown>[] {
  const list = Array.isArray(groups)
    ? groups.filter((item) => item && typeof item === "object") as Record<string, unknown>[]
    : [];
  const filtered = list.filter((item) => {
    const hooks = Array.isArray(item.hooks) ? item.hooks : [];
    return !hooks.some(isTokenPilotHookEntry);
  });
  filtered.push(group);
  return filtered;
}

function encodeMcpMessage(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  return Buffer.concat([header, body]);
}

function tryReadMcpInitializeResponse(buffer: Buffer): {
  consumedBytes: number;
  ok: boolean;
  detail: string;
} | null {
  const boundary = buffer.indexOf("\r\n\r\n");
  if (boundary < 0) return null;
  const headerText = buffer.slice(0, boundary).toString("utf8");
  const contentLengthMatch = /^content-length:\s*(\d+)$/im.exec(headerText);
  if (!contentLengthMatch) {
    return {
      consumedBytes: buffer.length,
      ok: false,
      detail: "missing Content-Length header in MCP initialize response",
    };
  }
  const contentLength = Number(contentLengthMatch[1]);
  const bodyStart = boundary + 4;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) return null;

  try {
    const parsed = JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8")) as {
      error?: { message?: string };
      result?: { serverInfo?: { name?: string } };
    };
    if (parsed?.error?.message) {
      return {
        consumedBytes: bodyEnd,
        ok: false,
        detail: `MCP initialize failed: ${parsed.error.message}`,
      };
    }
    return {
      consumedBytes: bodyEnd,
      ok: true,
      detail: `MCP initialize succeeded (${parsed?.result?.serverInfo?.name ?? "server"})`,
    };
  } catch {
    return {
      consumedBytes: bodyEnd,
      ok: false,
      detail: "invalid JSON in MCP initialize response",
    };
  }
}

async function probeClaudeCodeMcpServer(spec: TokenPilotMcpServerSpec, timeoutMs = CLAUDE_CODE_MCP_INSTALL_PROBE_TIMEOUT_MS): Promise<{
  ok: boolean;
  detail: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...spec.env,
      },
    });

    let settled = false;
    let stdoutBuffer = Buffer.alloc(0);
    let stderrBuffer = "";

    const finish = (result: { ok: boolean; detail: string; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        detail: `MCP initialize timed out after ${Math.ceil(timeoutMs / 1000)} seconds`,
      });
    }, timeoutMs);

    child.once("error", (error) => {
      finish({
        ok: false,
        timedOut: false,
        detail: `failed to start MCP process: ${error.message}`,
      });
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer = Buffer.concat([
        stdoutBuffer,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      ]);
      const parsed = tryReadMcpInitializeResponse(stdoutBuffer);
      if (!parsed) return;
      finish({
        ok: parsed.ok,
        timedOut: false,
        detail: parsed.ok
          ? parsed.detail
          : `${parsed.detail}${stderrBuffer.trim() ? ` | stderr: ${stderrBuffer.trim()}` : ""}`,
      });
    });

    child.once("exit", (code, signal) => {
      if (settled) return;
      finish({
        ok: false,
        timedOut: false,
        detail:
          `MCP process exited before initialize response`
          + ` (code=${code ?? "null"}, signal=${signal ?? "null"})`
          + `${stderrBuffer.trim() ? ` | stderr: ${stderrBuffer.trim()}` : ""}`,
      });
    });

    child.stdin.write(encodeMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "tokenpilot-claude-code-install",
          version: "0.1.0",
        },
      },
    }));
  });
}

export async function installClaudeCodeTokenPilot(params?: {
  settingsPath?: string;
  tokenPilotConfigPath?: string;
  mcpConfigPath?: string;
  probeMcp?: boolean;
}): Promise<{
  settingsPath: string;
  mcpConfigPath: string;
  tokenPilotConfigPath: string;
  proxyBaseUrl: string;
  stateDir: string;
  settingsBackedUp: boolean;
  mcpConfigBackedUp: boolean;
  hooksInstalled: boolean;
  toolSearchEnvName: string;
  toolSearchEnvValue: string;
  mcpServerName: string;
  expectedHookCommand: string;
  expectedMcpCommand: string;
  expectedMcpArgs: string[];
  expectedMcpStartupTimeoutSec: number;
  mcpProbe: {
    ok: boolean;
    detail: string;
    timedOut: boolean;
    degraded: boolean;
  };
}> {
  const settingsPath = params?.settingsPath ?? defaultClaudeCodeSettingsPath();
  const mcpConfigPath = params?.mcpConfigPath ?? defaultClaudeCodeMcpConfigPath();
  const tokenPilotConfigPath = params?.tokenPilotConfigPath ?? defaultTokenPilotClaudeCodeConfigPath();
  const config = await loadTokenPilotClaudeCodeConfig(tokenPilotConfigPath);
  await writeTokenPilotClaudeCodeConfig(config, tokenPilotConfigPath);
  const mcpServer = resolveClaudeCodeMcpServerSpecForInstall(config.stateDir);

  const existing = existsSync(settingsPath)
    ? JSON.parse(await readFile(settingsPath, "utf8"))
    : {};
  const root = asRecord(existing);
  const env = {
    ...asRecord(root.env),
    ANTHROPIC_BASE_URL: proxyBaseUrlForPort(config.proxyPort),
    [CLAUDE_TOOL_SEARCH_ENV]: CLAUDE_TOOL_SEARCH_DEFAULT,
  };
  const hooks = asRecord(root.hooks);
  const command = resolveClaudeCodeHookCommandForInstall();
  const handler = () => ({
    type: "command",
    command,
  });
  hooks.SessionStart = upsertHookGroup(hooks.SessionStart, { hooks: [handler()] });
  hooks.PreToolUse = upsertHookGroup(hooks.PreToolUse, { hooks: [handler()] });
  hooks.PostToolUse = upsertHookGroup(hooks.PostToolUse, { hooks: [handler()] });
  hooks.Stop = upsertHookGroup(hooks.Stop, { hooks: [handler()] });
  hooks.SessionEnd = upsertHookGroup(hooks.SessionEnd, { hooks: [handler()] });
  const next = {
    ...root,
    env,
    hooks,
  };

  await mkdir(dirname(settingsPath), { recursive: true });
  const settingsBackedUp = existsSync(settingsPath);
  if (existsSync(settingsPath)) {
    await copyFile(settingsPath, `${settingsPath}.tokenpilot.bak`);
  }
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  const mcpExisting = existsSync(mcpConfigPath)
    ? JSON.parse(await readFile(mcpConfigPath, "utf8"))
    : {};
  const mcpRoot = asRecord(mcpExisting);
  const mcpServers = {
    ...asRecord(mcpRoot.mcpServers),
    [mcpServer.serverName]: {
      command: mcpServer.command,
      args: mcpServer.args,
      env: mcpServer.env,
      startup_timeout_sec: CLAUDE_CODE_MCP_STARTUP_TIMEOUT_SEC,
    },
  };
  await mkdir(dirname(mcpConfigPath), { recursive: true });
  const mcpConfigBackedUp = existsSync(mcpConfigPath);
  if (existsSync(mcpConfigPath)) {
    await copyFile(mcpConfigPath, `${mcpConfigPath}.tokenpilot.bak`);
  }
  await writeFile(mcpConfigPath, `${JSON.stringify({ ...mcpRoot, mcpServers }, null, 2)}\n`, "utf8");
  const mcpProbe = params?.probeMcp === false
    ? {
      ok: false,
      timedOut: false,
      degraded: true,
      detail: "MCP startup probe skipped by installer options",
    }
    : await probeClaudeCodeMcpServer(mcpServer);
  return {
    settingsPath,
    mcpConfigPath,
    tokenPilotConfigPath,
    proxyBaseUrl: proxyBaseUrlForPort(config.proxyPort),
    stateDir: config.stateDir,
    settingsBackedUp,
    mcpConfigBackedUp,
    hooksInstalled: true,
    toolSearchEnvName: CLAUDE_TOOL_SEARCH_ENV,
    toolSearchEnvValue: CLAUDE_TOOL_SEARCH_DEFAULT,
    mcpServerName: mcpServer.serverName,
    expectedHookCommand: command,
    expectedMcpCommand: mcpServer.command,
    expectedMcpArgs: mcpServer.args,
    expectedMcpStartupTimeoutSec: CLAUDE_CODE_MCP_STARTUP_TIMEOUT_SEC,
    mcpProbe: {
      ...mcpProbe,
      degraded: !mcpProbe.ok,
    },
  };
}
