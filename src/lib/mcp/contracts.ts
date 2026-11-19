export type McpPermission = "read" | "write" | "tasks" | "execute";
type Field = { type: "string" | "integer"; description?: string; enum?: string[]; minimum?: number; maximum?: number; maxLength?: number };
export interface CabinetTool {
  name: string;
  description: string;
  permission: McpPermission;
  mutation?: boolean;
  inputSchema: { type: "object"; properties: Record<string, Field>; required: string[]; additionalProperties: false };
}
const text = (description?: string, maxLength = 1000): Field => ({ type: "string", description, maxLength });
const limit: Field = { type: "integer", minimum: 1, maximum: 100 };
function tool(name: string, description: string, permission: McpPermission, properties: Record<string, Field> = {}, required: string[] = [], mutation = false): CabinetTool {
  return { name, description, permission, mutation, inputSchema: { type: "object", additionalProperties: false,
    properties: { cabinetPath: text("Cabinet path returned by cabinet_list; defaults to the connection's first cabinet."), ...properties,
      ...(mutation ? { requestId: text("Unique operation ID. Reuse it when retrying the same request.", 128) } : {}) },
    required: [...required, ...(mutation ? ["requestId"] : [])] } };
}
export const CABINET_TOOLS: CabinetTool[] = [
  tool("cabinet_list", "List only cabinets granted to this MCP connection.", "read"),
  tool("cabinet_context", "Read cabinet instructions and connection capabilities.", "read"),
  tool("page_list", "List Markdown pages. Paths are relative to the selected cabinet. Use offset to paginate.", "read", { offset: { type: "integer", minimum: 0 }, limit }),
  tool("knowledge_search", "Search Markdown page titles and content within the selected cabinet. Results include source paths and revision hashes.", "read", { query: text(), offset: { type: "integer", minimum: 0 }, limit }, ["query"]),
  tool("page_read", "Read a Markdown page, its metadata, and exact file revision. Paginate long content with offset and limit.", "read", { path: text(), offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50000 } }, ["path"]),
  tool("page_create", "Create a new Markdown page with history attribution. Existing pages are never overwritten.", "write", { path: text(), title: text(), content: text(undefined, 500000) }, ["path", "title", "content"], true),
  tool("page_patch", "Replace Markdown content only if expectedRevision still matches. Read the page again after a conflict.", "write", { path: text(), expectedRevision: text(), content: text(undefined, 500000) }, ["path", "expectedRevision", "content"], true),
  tool("task_list", "List durable agent handoffs and their results.", "tasks", { agent: text(), limit }),
  tool("task_create", "Assign a durable task to an agent. Include acceptance criteria in the description and source paths in the text.", "tasks", { agent: text(), title: text(), description: text(undefined, 50000), priority: { type: "integer", minimum: 1, maximum: 5 } }, ["agent", "title", "description"], true),
  tool("task_update", "Update a handoff's status and completion summary.", "tasks", { agent: text(), taskId: text(), status: { type: "string", enum: ["pending", "in_progress", "completed", "failed"] }, result: text(undefined, 50000) }, ["agent", "taskId", "status"], true),
  tool("agent_list", "List agents available in the selected cabinet.", "read"),
  tool("run_start", "Start a Cabinet agent asynchronously. Returns a durable run ID. One active delegated run per connection prevents recursive handoffs. Execution uses the agent's existing runtime permissions.", "execute", { agent: text(), prompt: text(undefined, 50000) }, ["agent", "prompt"], true),
  tool("run_status", "Read the status of a run started by this connection.", "execute", { runId: text() }, ["runId"]),
  tool("run_result", "Read a delegated run's summary, output, and artifact references. Paginate output with offset and limit.", "execute", { runId: text(), offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50000 } }, ["runId"]),
  tool("run_cancel", "Cancel a run started by this connection.", "execute", { runId: text() }, ["runId"], true),
  tool("activity_list", "Inspect this connection's durable operation receipts, including request IDs and pending outcomes.", "read", { limit }),
];

export class McpError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function validateToolCall(name: string, input: unknown): { tool: CabinetTool; args: Record<string, string | number> } {
  const spec = CABINET_TOOLS.find(t => t.name === name);
  if (!spec) throw new McpError("unknown_tool", "Unknown Cabinet tool");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new McpError("invalid_arguments", "Arguments must be an object");
  const args = input as Record<string, string | number>;
  for (const key of spec.inputSchema.required) {
    if (!(key in args)) throw new McpError("invalid_arguments", `${key} is required`);
  }
  for (const [key, value] of Object.entries(args)) {
    const field = spec.inputSchema.properties[key];
    if (!field) throw new McpError("invalid_arguments", `Unknown argument: ${key}`);
    if (field.type === "string") {
      if (typeof value !== "string" || (key !== "content" && !value.trim()) || value.length > (field.maxLength ?? 1000) || (field.enum && !field.enum.includes(value))) throw new McpError("invalid_arguments", `Invalid ${key}`);
    } else if (typeof value !== "number" || !Number.isInteger(value) || value < (field.minimum ?? 0) || value > (field.maximum ?? Number.MAX_SAFE_INTEGER)) {
      throw new McpError("invalid_arguments", `Invalid ${key}`);
    }
  }
  return { tool: spec, args };
}
