import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { Wiki, DEFAULT_DB } from "./wiki.js";

declare const CABINET_MCP_WIKI_VERSION: string;

const VERSION =
  typeof CABINET_MCP_WIKI_VERSION === "string" ? CABINET_MCP_WIKI_VERSION : "0.0.0";

async function main(): Promise<void> {
  const dbPath = process.env.WIKI_DUCKDB?.trim() || DEFAULT_DB;
  const wiki = await Wiki.open(dbPath);

  const server = new McpServer({ name: "cabinet-mcp-wiki", version: VERSION });
  registerTools(server, wiki);

  await server.connect(new StdioServerTransport());
  console.error(`cabinet-mcp-wiki v${VERSION} ready (${dbPath}).`);
}

main().catch((err) => {
  console.error("cabinet-mcp-wiki: fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
