import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { DATA_DIR, CABINET_INTERNAL_DIR } from "@/lib/storage/path-utils";
import { writePage } from "@/lib/storage/page-io";
import { PageWriteConflict } from "@/lib/storage/page-write-lock";
import { invalidateTreeCache } from "@/lib/storage/tree-builder";
import { assertWritablePath } from "@/lib/knowledge-sources/store";
import { recordMutation } from "@/lib/history/engine";
import { getAllTasks, getTasksForAgent, createTask, updateTask } from "@/lib/agents/task-inbox";
import { listAllPersonas } from "@/lib/agents/persona-manager";
import { getDefaultProviderId } from "@/lib/agents/provider-runtime";
import { buildManualConversationPrompt, startConversationRun } from "@/lib/agents/conversation-runner";
import { readConversationMeta, readConversationDetail, finalizeConversation } from "@/lib/agents/conversation-store";
import { stopDaemonSession } from "@/lib/agents/daemon-client";
import { publishConversationEvent } from "@/lib/agents/conversation-events";
import { McpError, validateToolCall } from "./contracts";
import { McpState, assertId, cleanPath, digest, atomicJson, type McpConnection } from "./state";

export const mcpState = new McpState(path.join(CABINET_INTERNAL_DIR, "mcp"));
type Args = Record<string, string | number>;
const string = (args: Args, key: string) => args[key] as string;
const pageSize = (args: Args, fallback = 50) => Number(args.limit ?? fallback);
const virtualPath = (cp: string, relative: string) => cp === "." ? relative : `${cp}/${relative}`;
const inside = (base: string, target: string) => target === base || target.startsWith(base + path.sep);

async function cabinetRoot(cp: string) {
  const root = await fs.realpath(DATA_DIR);
  const cabinet = path.resolve(root, cp);
  if (!inside(root, cabinet)) throw new McpError("invalid_path", "Cabinet is outside the data directory", 403);
  // A granted cabinet may itself be an explicitly linked directory. Descendant
  // symlinks are excluded, so the grant never expands through arbitrary mounts.
  return fs.realpath(cabinet);
}
async function contentTarget(cp: string, relative: string): Promise<string> {
  cleanPath(relative);
  const base = await cabinetRoot(cp);
  let current = base;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (stat?.isSymbolicLink()) throw new McpError("linked_content", "Linked content is outside this MCP content grant", 403);
  }
  return current;
}
async function markdownFile(cp: string, relative: string): Promise<string | null> {
  const target = await contentTarget(cp, relative);
  const candidates = relative.endsWith(".md") ? [target] : [path.join(target, "index.md"), `${target}.md`];
  for (const file of candidates) {
    const stat = await fs.lstat(file).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT" || e.code === "ENOTDIR") return null; throw e; });
    if (stat?.isSymbolicLink()) throw new McpError("linked_content", "Linked content is outside this MCP content grant", 403);
    if (stat?.isFile()) return file;
  }
  return null;
}
async function readMarkdown(cp: string, relative: string) {
  const file = await markdownFile(cp, relative);
  if (!file) throw new McpError("not_found", "Markdown page not found", 404);
  if ((await fs.stat(file)).size > 2_000_000) throw new McpError("page_too_large", "Page exceeds the MCP read limit");
  const raw = await fs.readFile(file, "utf8");
  const parsed = matter(raw);
  return { path: relative, title: String(parsed.data.title ?? path.basename(relative, ".md")), frontmatter: parsed.data, content: parsed.content, revision: digest(raw) };
}
async function listPages(cp: string): Promise<string[]> {
  const base = await cabinetRoot(cp);
  const pages: string[] = [];
  let visited = 0;
  async function walk(dir: string, depth: number) {
    if (depth > 30) throw new McpError("scan_limit", "Cabinet exceeds the MCP directory-depth limit");
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visited > 50000) throw new McpError("scan_limit", "Cabinet exceeds the MCP scan limit");
      if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "__pycache__"].includes(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".md")) pages.push(path.relative(base, file).split(path.sep).join("/"));
    }
  }
  await walk(base, 0);
  return pages;
}
async function agents(cp: string) {
  const available = (await listAllPersonas()).filter(p => (p.cabinetPath || ".") === cp)
    .map(p => ({ slug: p.slug, name: p.name, provider: p.provider, role: p.role }));
  if (!available.some(p => p.slug === "editor")) available.push({ slug: "editor", name: "Cabinet assistant", provider: getDefaultProviderId(), role: "General assistant using Cabinet\'s default provider" });
  return available;
}
async function requireAgent(cp: string, slug: string) {
  assertId(slug);
  const agent = (await agents(cp)).find(p => p.slug === slug);
  if (!agent) throw new McpError("agent_not_found", "Agent is not in the selected cabinet", 404);
  return agent;
}
function activeFile(c: McpConnection) { return path.join(mcpState.connectionDir(c), "active-run.json"); }
async function ownedRun(c: McpConnection, cp: string, id: string) {
  assertId(id);
  const receipts = await mcpState.receipts(c);
  if (!receipts.some(r => r.tool === "run_start" && r.cabinetPath === cp && (r.result as { runId?: string })?.runId === id)) throw new McpError("run_not_owned", "Run was not started by this connection in this cabinet", 403);
  const meta = await readConversationMeta(id, cp);
  if (!meta) throw new McpError("not_found", "Run not found", 404);
  return meta;
}
async function startRun(c: McpConnection, cp: string, args: Args, checkpoint: (result: unknown) => Promise<void>) {
  return mcpState.locked(`run:${c.id}`, async () => {
    const file = activeFile(c);
    const active = await fs.readFile(file, "utf8").then(raw => JSON.parse(raw) as { runId?: string; cabinetPath: string }).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (active) {
      const previous = active.runId ? await readConversationMeta(active.runId, active.cabinetPath) : null;
      if (!previous || ["running", "idle"].includes(previous.status)) throw new McpError("delegation_busy", "This connection already has an active or unresolved delegation. Inspect its run or operation receipt before starting another.", 409);
    }
    const agent = await requireAgent(cp, string(args, "agent"));
    const input = await buildManualConversationPrompt({ agentSlug: agent.slug, cabinetPath: cp, userMessage: string(args, "prompt") });
    if ((input.cabinetPath || ".") !== cp) throw new McpError("scope_mismatch", "Agent resolved to another cabinet", 403);
    await atomicJson(file, { requestId: args.requestId, cabinetPath: cp, state: "starting" });
    const run = await startConversationRun({ ...input, agentSlug: agent.slug, cabinetPath: cp, trigger: "agent",
      onCreated: async meta => {
        await atomicJson(file, { runId: meta.id, cabinetPath: cp });
        await checkpoint({ runId: meta.id, status: meta.status, cabinetPath: cp });
      },
      prompt: `${input.prompt}\n\nMCP handoff from ${c.id}; request ${args.requestId}. Return durable results and source references. Do not delegate back to the originating system.` });
    await atomicJson(file, { runId: run.id, cabinetPath: cp });
    return { runId: run.id, status: run.status, cabinetPath: cp };
  });
}

async function dispatch(c: McpConnection, cp: string, name: string, args: Args, checkpoint: (result: unknown) => Promise<void> = async () => {}): Promise<unknown> {
  switch (name) {
    case "cabinet_list": return { cabinets: c.cabinets.map(cabinetPath => ({ cabinetPath })), permissions: c.permissions };
    case "cabinet_context": {
      const instructions = [];
      for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
        const file = await markdownFile(cp, filename);
        if (file) instructions.push(await readMarkdown(cp, filename));
      }
      const overview = await markdownFile(cp, "index.md") ? await readMarkdown(cp, "index.md") : null;
      return { cabinetPath: cp, connection: c.id, permissions: c.permissions, instructions, overview, paths: "All page paths are relative to this cabinet. Hidden files and descendant symlinks are excluded. Execution runs with the configured agent's normal runtime access, not a filesystem sandbox." };
    }
    case "page_list": {
      const pages = await listPages(cp);
      const offset = Number(args.offset ?? 0), limit = pageSize(args);
      return { pages: pages.slice(offset, offset + limit).map(path => ({ path })), total: pages.length, nextOffset: offset + limit < pages.length ? offset + limit : null };
    }
    case "page_read": {
      const page = await readMarkdown(cp, string(args, "path"));
      const offset = Number(args.offset ?? 0), limit = pageSize(args, 50000);
      return { ...page, content: page.content.slice(offset, offset + limit), totalCharacters: page.content.length, nextOffset: offset + limit < page.content.length ? offset + limit : null };
    }
    case "knowledge_search": {
      const query = string(args, "query").toLowerCase();
      const matches = [];
      for (const relative of await listPages(cp)) {
        const page = await readMarkdown(cp, relative);
        const index = page.content.toLowerCase().indexOf(query);
        if (index >= 0 || page.title.toLowerCase().includes(query) || relative.toLowerCase().includes(query)) matches.push({ path: relative, title: page.title, revision: page.revision, excerpt: page.content.slice(Math.max(0, index - 120), Math.max(0, index - 120) + 500) });
      }
      const offset = Number(args.offset ?? 0), limit = pageSize(args);
      return { matches: matches.slice(offset, offset + limit), total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null };
    }
    case "page_create": case "page_patch": {
      const relative = cleanPath(string(args, "path"));
      if (!relative.endsWith(".md")) throw new McpError("invalid_path", "Writes require an explicit .md path");
      const target = await contentTarget(cp, relative);
      return mcpState.locked(`page:${target}`, async () => {
        const existing = await markdownFile(cp, relative);
        if (name === "page_create" && existing) throw new McpError("already_exists", "Page already exists", 409);
        const page = name === "page_patch" ? await readMarkdown(cp, relative) : null;
        if (page && page.revision !== args.expectedRevision) throw new McpError("revision_conflict", "Page changed since it was read. Read it again before editing.", 409);
        const fullPath = virtualPath(cp, relative);
        await assertWritablePath(fullPath);
        try {
          await writePage(fullPath, string(args, "content"), page?.frontmatter ?? { title: string(args, "title"), created: new Date().toISOString(), tags: [] },
            page ? { expectedRevision: page.revision } : { createOnly: true });
        } catch (error) {
          if (error instanceof PageWriteConflict) throw new McpError(error.reason, error.message, 409);
          throw error;
        }
        invalidateTreeCache();
        await recordMutation({ op: name === "page_create" ? "create" : "write", virtualPath: fullPath,
          actor: { kind: "agent", slug: c.id, cabinetPath: cp, displayName: `MCP ${c.id}`, conversationId: string(args, "requestId"), runtime: "mcp" }, message: `MCP ${c.id}: ${name} ${relative}` });
        const saved = await readMarkdown(cp, relative);
        return { path: relative, revision: saved.revision, requestId: args.requestId };
      });
    }
    case "agent_list": return { agents: (await agents(cp)).map(a => ({ slug: a.slug, name: a.name, provider: a.provider, role: a.role })) };
    case "task_list": {
      if (args.agent) await requireAgent(cp, string(args, "agent"));
      const tasks = args.agent ? await getTasksForAgent(string(args, "agent"), undefined, cp) : await getAllTasks(undefined, cp);
      return { tasks: tasks.slice(0, pageSize(args)), total: tasks.length };
    }
    case "task_create": {
      const agent = await requireAgent(cp, string(args, "agent"));
      return createTask({ fromAgent: `mcp-${c.id}`, fromName: c.id, toAgent: agent.slug, title: string(args, "title"), description: string(args, "description"), priority: Number(args.priority ?? 3), kbRefs: [], cabinetPath: cp });
    }
    case "task_update": {
      const slug = string(args, "agent"); await requireAgent(cp, slug); assertId(string(args, "taskId"));
      const task = await updateTask(slug, string(args, "taskId"), { status: string(args, "status") as "pending" | "in_progress" | "completed" | "failed", ...(args.result !== undefined ? { result: string(args, "result") } : {}) }, cp);
      if (!task) throw new McpError("not_found", "Task not found", 404);
      return task;
    }
    case "run_start": return startRun(c, cp, args, checkpoint);
    case "run_status": {
      const meta = await ownedRun(c, cp, string(args, "runId"));
      return { runId: meta.id, status: meta.status, title: meta.title, startedAt: meta.startedAt, completedAt: meta.completedAt, awaitingInput: meta.awaitingInput };
    }
    case "run_result": {
      const meta = await ownedRun(c, cp, string(args, "runId"));
      const detail = await readConversationDetail(meta.id, cp);
      const output = detail?.transcript ?? "";
      const offset = Number(args.offset ?? 0), limit = pageSize(args, 50000);
      return { runId: meta.id, status: meta.status, summary: meta.summary, output: output.slice(offset, offset + limit), artifacts: detail?.artifacts ?? [], totalCharacters: output.length, nextOffset: offset + limit < output.length ? offset + limit : null };
    }
    case "run_cancel": {
      const meta = await ownedRun(c, cp, string(args, "runId"));
      if (!["completed", "failed", "cancelled"].includes(meta.status)) {
        if (!(await stopDaemonSession(meta.id))) throw new McpError("daemon_unavailable", "Daemon did not confirm cancellation; inspect run_status before retrying", 503);
        await finalizeConversation(meta.id, { status: "cancelled", exitCode: 1 }, cp);
        publishConversationEvent({ type: "task.updated", taskId: meta.id, cabinetPath: cp, payload: { action: "stop", source: "mcp" } });
      }
      return { runId: meta.id, status: (await readConversationMeta(meta.id, cp))?.status };
    }
    case "activity_list": return { operations: (await mcpState.receipts(c)).filter(r => r.cabinetPath === cp).slice(0, pageSize(args)) };
    default: throw new McpError("unknown_tool", "Unknown tool");
  }
}

export async function executeCabinetTool(connection: McpConnection, name: string, input: unknown): Promise<unknown> {
  const { tool, args } = validateToolCall(name, input);
  if (!connection.permissions.includes(tool.permission)) throw new McpError("forbidden", `Connection does not grant ${tool.permission}`, 403);
  const cp = cleanPath(String(args.cabinetPath ?? connection.cabinets[0]), true);
  if (!connection.cabinets.includes(cp)) throw new McpError("forbidden", "Cabinet is not granted to this connection", 403);
  if (tool.mutation) return mcpState.once(connection, string(args, "requestId"), name, cp, args, checkpoint => dispatch(connection, cp, name, args, checkpoint));
  return dispatch(connection, cp, name, args);
}
