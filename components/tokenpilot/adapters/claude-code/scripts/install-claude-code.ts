import { installClaudeCodeTokenPilot } from "../src/install.js";

async function main() {
  const result = await installClaudeCodeTokenPilot();
  console.log([
    "TokenPilot Claude Code install complete:",
    `- settings: ${result.settingsPath}`,
    `- settings backup created: ${result.settingsBackedUp ? "yes" : "no"}`,
    `- mcp config: ${result.mcpConfigPath}`,
    `- mcp config backup created: ${result.mcpConfigBackedUp ? "yes" : "no"}`,
    `- tokenpilot config: ${result.tokenPilotConfigPath}`,
    `- state dir: ${result.stateDir}`,
    `- proxy base URL: ${result.proxyBaseUrl}`,
    `- observability hooks installed: ${result.hooksInstalled ? "yes" : "no"}`,
    `- expected hook command: ${result.expectedHookCommand}`,
    `- expected MCP command: ${result.expectedMcpCommand}`,
    `- expected MCP args: ${result.expectedMcpArgs.join(" ")}`,
    `- tool search env: ${result.toolSearchEnvName}=${result.toolSearchEnvValue}`,
    `- recovery MCP server: ${result.mcpServerName}`,
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
