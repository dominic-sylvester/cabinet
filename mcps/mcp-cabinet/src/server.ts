import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

export async function serve(name: string, list: () => Promise<Tool[]>, call: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  const server = new Server({ name, version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await list() }));
  server.setRequestHandler(CallToolRequestSchema, async req => {
    try {
      const result = await call(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed" }) }] };
    }
  });
  await server.connect(new StdioServerTransport());
}
