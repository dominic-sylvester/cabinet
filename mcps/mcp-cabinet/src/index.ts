import fs from "node:fs/promises";
import { serve } from "./server.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

async function main() {
  const file = process.env.CABINET_MCP_CONNECTION;
  if (!file) throw new Error("Set CABINET_MCP_CONNECTION to the private connection file created by scripts/mcp-connect.ts");
  const config = JSON.parse(await fs.readFile(file, "utf8")) as { url: string; token: string };
  const url = new URL(config.url);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/api/mcp" || url.username || url.password) throw new Error("This bridge requires a local Cabinet /api/mcp endpoint");
  async function request(tool: string, args: unknown = {}) {
    const response = await fetch(url, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" }, body: JSON.stringify({ tool, arguments: args }), signal: AbortSignal.timeout(90000) });
    const body = await response.json() as { result?: unknown; tools?: Tool[]; error?: { code: string; message: string } };
    if (!response.ok) throw new Error(`${body.error?.code ?? response.status}: ${body.error?.message ?? "Cabinet request failed"}`);
    return body;
  }
  await serve("cabinet", async () => (await request("tools_list")).tools ?? [], async (name, args) => (await request(name, args)).result);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
