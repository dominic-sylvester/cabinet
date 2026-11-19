import { NextRequest, NextResponse } from "next/server";
import { McpError, CABINET_TOOLS } from "@/lib/mcp/contracts";
import { mcpState, executeCabinetTool } from "@/lib/mcp/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const connection = await mcpState.authenticate(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 600000) throw new McpError("request_too_large", "MCP request exceeds 600 KB", 413);
    let body;
    try { body = JSON.parse(raw); } catch { throw new McpError("invalid_json", "Request must contain valid JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.tool !== "string") throw new McpError("invalid_request", "Request must specify a tool");
    if (body.tool === "tools_list") return NextResponse.json({ tools: CABINET_TOOLS.filter(t => connection.permissions.includes(t.permission)).map(t => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      annotations: { readOnlyHint: !t.mutation, destructiveHint: !!t.mutation, idempotentHint: !!t.mutation },
    })) });
    const result = await executeCabinetTool(connection, body.tool, body.arguments ?? {});
    return NextResponse.json({ result });
  } catch (e) {
    const error = e instanceof McpError ? e : new McpError("internal_error", "MCP operation failed. Inspect local diagnostics.", 500);
    if (!(e instanceof McpError)) console.error("[mcp]", e);
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
}
