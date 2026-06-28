import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveTokenPilotMcpServerSpec, type TokenPilotMcpServerSpec } from "@tokenpilot/mcp";
import {
  defaultCodexConfigPath,
  defaultHooksConfigPath,
  defaultTokenPilotConfigPath,
  loadTokenPilotCodexConfig,
  writeTokenPilotCodexConfig,
} from "./config.js";

const CODEX_MCP_STARTUP_TIMEOUT_SEC = 90;
const CODEX_MCP_INSTALL_PROBE_TIMEOUT_MS = 15_000;

function quoteToml(value: string): string {
  return JSON.stringify(value);
}

function replaceOrInsertRootAssignment(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  let inRoot = true;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^\[.+\]$/.test(trimmed)) inRoot = false;
    if (!inRoot) break;
    if (new RegExp(`^${key}\\s*=`).test(trimmed)) {
      lines[i] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }
  lines.unshift(`${key} = ${value}`);
  return lines.join("\n");
}

function upsertProviderSection(text: string, params: {
  providerName: string;
  baseUrl: string;
}): string {
  const sectionHeader = `[model_providers.${params.providerName}]`;
  const section = [
    sectionHeader,
    `name = ${quoteToml("TokenPilot")}`,
    `base_url = ${quoteToml(params.baseUrl)}`,
    `wire_api = ${quoteToml("responses")}`,
    "requires_openai_auth = true",
  ].join("\n");
  const sectionRe = new RegExp(`\\n?\\[model_providers\\.${params.providerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][\\s\\S]*?(?=\\n\\[[^\\]]+\\]|$)`);
  if (sectionRe.test(text)) {
    return text.replace(sectionRe, `\n${section}\n`);
  }
  return `${text.replace(/\s*$/, "")}\n\n${section}\n`;
}

function upsertMcpServerSection(text: string, params: {
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  startupTimeoutSec?: number;
}): string {
  const escape = (value: string) => JSON.stringify(value);
  const sectionHeader = `[mcp_servers.${params.serverName}]`;
  const lines = [
    sectionHeader,
    `command = ${escape(params.command)}`,
  ];
  if (params.args.length > 0) {
    lines.push(`args = [${params.args.map((value) => escape(value)).join(", ")}]`);
  }
  if (typeof params.startupTimeoutSec === "number" && Number.isFinite(params.startupTimeoutSec) && params.startupTimeoutSec > 0) {
    lines.push(`startup_timeout_sec = ${Math.trunc(params.startupTimeoutSec)}`);
  }
  const envEntries = Object.entries(params.env);
  if (envEntries.length > 0) {
    lines.push("", `[mcp_servers.${params.serverName}.env]`);
    for (const [key, value] of envEntries) {
      lines.push(`${key} = ${escape(value)}`);
    }
  }
  const section = lines.join("\n");
  const escapedServer = params.serverName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRe = new RegExp(`\\n?\\[mcp_servers\\.${escapedServer}\\][\\s\\S]*?(?=\\n\\[[^\\]]+\\]|$)`);
  if (sectionRe.test(text)) {
    return text.replace(sectionRe, `\n${section}\n`);
  }
  return `${text.replace(/\s*$/, "")}\n\n${section}\n`;
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

async function probeCodexMcpServer(spec: TokenPilotMcpServerSpec, timeoutMs = CODEX_MCP_INSTALL_PROBE_TIMEOUT_MS): Promise<{
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
      if (!child.killed) {
        child.kill();
      }
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
          name: "tokenpilot-codex-install",
          version: "0.1.0",
        },
      },
    }));
  });
}

function adapterRootFromHere(): string {
  const moduleDir = __dirname;
  const fromDist = resolve(moduleDir, "..");
  if (
    existsSync(join(fromDist, "package.json"))
    && existsSync(join(fromDist, "dist", "hooks-handler.js"))
  ) {
    return fromDist;
  }
  const fromSrc = resolve(moduleDir, "..");
  if (
    existsSync(join(fromSrc, "package.json"))
    && existsSync(join(fromSrc, "src"))
  ) {
    return fromSrc;
  }
  let current = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (
      existsSync(join(current, "package.json"))
      && existsSync(join(current, "src"))
      && existsSync(join(current, "scripts"))
    ) {
      return current;
    }
    const nested = join(current, "components", "tokenpilot", "adapters", "codex");
    if (existsSync(join(nested, "package.json"))) return nested;
    current = dirname(current);
  }
  return join(process.cwd(), "components", "tokenpilot", "adapters", "codex");
}

function shellQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function tokenPilotHookCommand(adapterRoot: string): string {
  return `${shellQuote(process.execPath)} ${shellQuote(join(adapterRoot, "dist", "hooks-handler.js"))}`;
}

export function resolveCodexHookCommandForInstall(): string {
  return tokenPilotHookCommand(adapterRootFromHere());
}

export function resolveCodexMcpServerSpecForInstall(stateDir: string): TokenPilotMcpServerSpec {
  return resolveTokenPilotMcpServerSpec({
    stateDir,
  });
}

function asHookConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function upsertTokenPilotHookGroup(groups: unknown, group: Record<string, unknown>): Record<string, unknown>[] {
  const list = Array.isArray(groups) ? groups.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
  const isTokenPilotGroup = (item: Record<string, unknown>): boolean => {
    const hooks = Array.isArray(item.hooks) ? item.hooks : [];
    return hooks.some((hook) => {
      if (!hook || typeof hook !== "object") return false;
      const command = (hook as Record<string, unknown>).command;
      return typeof command === "string" && command.includes("hooks-handler.js");
    });
  };
  const filtered = list.filter((item) => !isTokenPilotGroup(item));
  return [...filtered, group];
}

async function installHooksJson(params: {
  hooksConfigPath: string;
  adapterRoot: string;
}): Promise<void> {
  const existing = existsSync(params.hooksConfigPath)
    ? JSON.parse(await readFile(params.hooksConfigPath, "utf8"))
    : {};
  const root = asHookConfig(existing);
  const hooks = asHookConfig(root.hooks);
  const command = tokenPilotHookCommand(params.adapterRoot);
  const handler = (statusMessage: string, timeout = 30) => ({
    type: "command",
    command,
    statusMessage,
    timeout,
  });

  hooks.SessionStart = upsertTokenPilotHookGroup(hooks.SessionStart, {
    matcher: "startup|resume",
    hooks: [handler("Starting TokenPilot Codex proxy")],
  });
  hooks.PreToolUse = upsertTokenPilotHookGroup(hooks.PreToolUse, {
    matcher: ".*",
    hooks: [handler("Recording TokenPilot pre-tool metadata", 10)],
  });
  hooks.PostToolUse = upsertTokenPilotHookGroup(hooks.PostToolUse, {
    matcher: ".*",
    hooks: [handler("Recording TokenPilot tool output", 10)],
  });
  hooks.Stop = upsertTokenPilotHookGroup(hooks.Stop, {
    hooks: [handler("Recording TokenPilot session stop", 10)],
  });

  await mkdir(dirname(params.hooksConfigPath), { recursive: true });
  if (existsSync(params.hooksConfigPath)) {
    await copyFile(params.hooksConfigPath, `${params.hooksConfigPath}.tokenpilot.bak`);
  }
  await writeFile(params.hooksConfigPath, `${JSON.stringify({ ...root, hooks }, null, 2)}\n`, "utf8");
}

export async function installCodexTokenPilot(params?: {
  codexConfigPath?: string;
  tokenPilotConfigPath?: string;
  hooksConfigPath?: string;
  providerName?: string;
  installHooks?: boolean;
  probeMcp?: boolean;
}): Promise<{
  codexConfigPath: string;
  tokenPilotConfigPath: string;
  hooksConfigPath: string;
  providerName: string;
  baseUrl: string;
  hooksInstalled: boolean;
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
  const codexConfigPath = params?.codexConfigPath ?? defaultCodexConfigPath();
  const tokenPilotConfigPath = params?.tokenPilotConfigPath ?? defaultTokenPilotConfigPath();
  const hooksConfigPath = params?.hooksConfigPath ?? defaultHooksConfigPath();
  const providerName = params?.providerName ?? "tokenpilot";
  const tokenPilotConfig = await loadTokenPilotCodexConfig(tokenPilotConfigPath);
  tokenPilotConfig.providerName = providerName;
  await writeTokenPilotCodexConfig(tokenPilotConfig, tokenPilotConfigPath);
  const baseUrl = `http://127.0.0.1:${tokenPilotConfig.proxyPort}/v1`;
  const mcpServer = resolveCodexMcpServerSpecForInstall(tokenPilotConfig.stateDir);

  await mkdir(dirname(codexConfigPath), { recursive: true });
  const existing = existsSync(codexConfigPath) ? await readFile(codexConfigPath, "utf8") : "";
  if (existsSync(codexConfigPath)) {
    await copyFile(codexConfigPath, `${codexConfigPath}.tokenpilot.bak`);
  }
  let next = replaceOrInsertRootAssignment(existing, "model_provider", quoteToml(providerName));
  next = upsertProviderSection(next, { providerName, baseUrl });
  next = upsertMcpServerSection(next, {
    serverName: mcpServer.serverName,
    command: mcpServer.command,
    args: mcpServer.args,
    env: mcpServer.env,
    startupTimeoutSec: CODEX_MCP_STARTUP_TIMEOUT_SEC,
  });
  await writeFile(codexConfigPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  const hooksInstalled = params?.installHooks !== false;
  if (hooksInstalled) {
    await installHooksJson({
      hooksConfigPath,
      adapterRoot: adapterRootFromHere(),
    });
  }
  const expectedHookCommand = resolveCodexHookCommandForInstall();
  const mcpProbe = params?.probeMcp === false
    ? {
      ok: false,
      timedOut: false,
      degraded: true,
      detail: "MCP startup probe skipped by installer options",
    }
    : await probeCodexMcpServer(mcpServer);
  return {
    codexConfigPath,
    tokenPilotConfigPath,
    hooksConfigPath,
    providerName,
    baseUrl,
    hooksInstalled,
    mcpServerName: mcpServer.serverName,
    expectedHookCommand,
    expectedMcpCommand: mcpServer.command,
    expectedMcpArgs: mcpServer.args,
    expectedMcpStartupTimeoutSec: CODEX_MCP_STARTUP_TIMEOUT_SEC,
    mcpProbe: {
      ...mcpProbe,
      degraded: !mcpProbe.ok,
    },
  };
}
