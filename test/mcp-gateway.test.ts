import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { McpState, cleanPath, type McpConnection } from "../src/lib/mcp/state";
import { CABINET_TOOLS, validateToolCall } from "../src/lib/mcp/contracts";
import { executeCabinetTool, mcpState } from "../src/lib/mcp/gateway";
import { DATA_DIR } from "../src/lib/storage/path-utils";
import { POST } from "../src/app/api/mcp/route";
import { NextRequest } from "next/server";
import { createConversation } from "../src/lib/agents/conversation-store";
import { writePage } from "../src/lib/storage/page-io";
import { PageWriteConflict } from "../src/lib/storage/page-write-lock";

let temporary: string;
let state: McpState;
let connection: McpConnection;
const cabinet = `mcp-test-${randomUUID()}`;
const id = `test-${randomUUID()}`;
const call = (name: string, args: Record<string, unknown> = {}, grant = connection) => executeCabinetTool(grant, name, { cabinetPath: cabinet, ...args });
before(async () => {
  assert.ok(process.env.CABINET_DATA_DIR, "Run via npm test so MCP fixtures never touch real content");
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-mcp-test-"));
  state = new McpState(temporary);
  connection = (await mcpState.provision(id, [cabinet], ["read", "write", "tasks", "execute"])).connection;
  await fs.mkdir(path.join(DATA_DIR, cabinet), { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, cabinet, "AGENTS.md"), "# Instructions\nKeep source references.");
});
after(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.rm(path.join(DATA_DIR, cabinet), { recursive: true, force: true });
  await fs.rm(mcpState.connectionDir(connection), { recursive: true, force: true });
  await fs.rm(path.join(mcpState.root, "connections", `${id}.json`), { force: true });
});

test("connection credentials are private, hashed, scoped, and revocable", async () => {
  const { token, connection: c } = await state.provision("reader", [cabinet], ["read"]);
  const file = path.join(temporary, "connections/reader.json");
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.ok(!(await fs.readFile(file, "utf8")).includes(token));
  assert.deepEqual(await state.authenticate(token), c);
  await assert.rejects(state.authenticate("0".repeat(64)), /Invalid MCP connection/);
  await assert.rejects(state.authenticate("../reader"), /Invalid MCP connection/);
  await fs.unlink(file);
  await assert.rejects(state.authenticate(token), /Invalid MCP connection/);
});

test("operation receipts replay across restarts and reject changed arguments", async () => {
  let invoked = 0;
  const action = async () => ({ taskId: ++invoked });
  const original = await state.once(connection, "op-1", "task_create", cabinet, { title: "A", priority: 1 }, action);
  const restarted = new McpState(temporary);
  assert.deepEqual(await restarted.once(connection, "op-1", "task_create", cabinet, { priority: 1, title: "A" }, action), original);
  assert.equal(invoked, 1);
  await assert.rejects(state.once(connection, "op-1", "task_create", cabinet, { title: "B" }, action), /different arguments/);
});

test("overlapping or interrupted requests never dispatch twice", async () => {
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(r => { started = r; });
  const pending = new Promise<void>(r => { release = r; });
  const first = state.once(connection, "overlap", "run_start", cabinet, {}, async () => { started(); await pending; return { runId: "run-1" }; });
  await ready;
  await assert.rejects(new McpState(temporary).once(connection, "overlap", "run_start", cabinet, {}, async () => { assert.fail("duplicate dispatch"); }), /in progress/);
  release(); await first;
  let calls = 0;
  await assert.rejects(state.once(connection, "failed", "page_patch", cabinet, {}, async () => { calls++; throw new Error("after a possible side effect"); }), /Operation failed/);
  await assert.rejects(state.once(connection, "failed", "page_patch", cabinet, {}, async () => { calls++; }), /Operation failed/);
  assert.equal(calls, 1);
});

test("checkpointed run IDs remain inspectable after a dispatch failure", async () => {
  await assert.rejects(state.once(connection, "checkpoint", "run_start", cabinet, {}, async checkpoint => {
    await checkpoint({ runId: "known-before-spawn" });
    throw new Error("spawn failed");
  }));
  const receipt = (await state.receipts(connection)).find(r => r.requestId === "checkpoint");
  assert.deepEqual(receipt?.result, { runId: "known-before-spawn" });
  assert.equal(receipt?.status, "failed");
});

test("validation rejects unknown arguments, traversal, hidden state, and invalid pagination", () => {
  for (const p of ["../outside.md", "/etc/passwd", "nested/../../a", ".agents/secrets", "a//b", "a\\b", "a/./b", "a\0b"]) assert.throws(() => cleanPath(p));
  for (const args of [{ path: "a.md", offset: -1 }, { path: "a.md", limit: 50001 }, { path: "a.md", arbitrary: true }, { path: 10 }, { path: "" }]) assert.throws(() => validateToolCall("page_read", args));
  assert.throws(() => validateToolCall("page_patch", { path: "a.md", content: "", requestId: "x" }));
  assert.throws(() => validateToolCall("shell_exec", {}));
  assert.equal(new Set(CABINET_TOOLS.map(t => t.name)).size, CABINET_TOOLS.length);
});

test("gateway requires its own token even without a KB password", async () => {
  const response = await POST(new NextRequest("http://localhost/api/mcp", { method: "POST", body: JSON.stringify({ tool: "cabinet_list" }) }));
  assert.equal(response.status, 401);
  const { token } = await mcpState.provision(`auth-${id}`, [cabinet], ["read"]);
  try {
    const malformed = await POST(new NextRequest("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{" }));
    assert.equal(malformed.status, 400);
    const response = await POST(new NextRequest("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ tool: "tools_list" }) }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.tools.some((t: { name: string }) => t.name === "page_read"));
    assert.ok(!body.tools.some((t: { name: string }) => t.name === "page_create" || t.name === "run_start"));
  } finally { await fs.rm(path.join(mcpState.root, "connections", `auth-${id}.json`)); }
});

test("grants cannot read another cabinet, write with read-only access, or inspect another run", async () => {
  await assert.rejects(call("page_list", { cabinetPath: "." }), /not granted/);
  await assert.rejects(call("page_create", { path: "a.md", title: "A", content: "", requestId: "denied" }, { ...connection, permissions: ["read"] }), /does not grant write/);
  await assert.rejects(call("run_status", { runId: "some-other-run" }), /not started by this connection/);
});

test("delegated run ownership survives a failed dispatch and supports durable results", async () => {
  const meta = await createConversation({ agentSlug: "editor", cabinetPath: cabinet, title: "Stored result", trigger: "agent", prompt: "A test prompt", initialStatus: "completed" });
  await assert.rejects(mcpState.once(connection, "owned-run", "run_start", cabinet, {}, async checkpoint => {
    await checkpoint({ runId: meta.id });
    throw new Error("simulated response failure");
  }));
  const status = await call("run_status", { runId: meta.id }) as { runId: string; status: string };
  assert.equal(status.runId, meta.id); assert.equal(status.status, "completed");
  const result = await call("run_result", { runId: meta.id }) as { runId: string; artifacts: unknown[] };
  assert.equal(result.runId, meta.id); assert.deepEqual(result.artifacts, []);
  const stopped = await call("run_cancel", { runId: meta.id, requestId: "cancel-completed" }) as { status: string };
  assert.equal(stopped.status, "completed");
  await assert.rejects(call("run_status", { runId: meta.id }, { ...connection, id: `other-${id}` }), /not started by this connection/);
});

test("Cabinet exposes a default assistant without creating a persona or starting it", async () => {
  const available = await call("agent_list") as { agents: Array<{ slug: string }> };
  assert.ok(available.agents.some(a => a.slug === "editor"));
  await assert.rejects(call("run_start", { agent: "nonexistent-agent", prompt: "Do not execute", requestId: "missing-agent" }), /not in the selected cabinet/);
});

test("task handoffs and their completion results persist without launching an agent", async () => {
  const args = { agent: "editor", title: "Review filing", description: "Acceptance: save a sourced memo and link it in the result.", requestId: "task-handoff" };
  const task = await call("task_create", args) as { id: string; status: string };
  assert.equal(task.status, "pending");
  assert.deepEqual(await call("task_create", args), task);
  const result = await call("task_update", { agent: "editor", taskId: task.id, status: "completed", result: "Saved research/memo.md", requestId: "task-complete" }) as { completedAt: string; result: string };
  assert.ok(result.completedAt); assert.equal(result.result, "Saved research/memo.md");
  const listed = await call("task_list", { agent: "editor" }) as { tasks: Array<{ id: string }> };
  assert.ok(listed.tasks.some(t => t.id === task.id));
  await assert.rejects(call("task_update", { agent: "editor", taskId: "../other", status: "failed", requestId: "traversal-task" }), /Invalid identifier/);
});

test("page writes preserve metadata, attribute history, replay safely, and reject stale revisions", async () => {
  const args = { path: "research/memo.md", title: "Memo", content: "# Findings\nSource: annual report.", requestId: "create-memo" };
  const created = await call("page_create", args) as { revision: string };
  assert.deepEqual(await call("page_create", args), created);
  const read = await call("page_read", { path: args.path, limit: 5 }) as { content: string; revision: string; nextOffset: number };
  assert.equal(read.content.length, 5); assert.equal(read.nextOffset, 5); assert.equal(read.revision, created.revision);
  const update = { path: args.path, content: "# Updated\nSource: filing.", expectedRevision: read.revision, requestId: "update-memo" };
  const updated = await call("page_patch", update) as { revision: string };
  assert.notEqual(updated.revision, read.revision);
  await assert.rejects(call("page_patch", { ...update, requestId: "stale" }), /changed since/);
  await assert.rejects(call("page_create", { ...args, requestId: "duplicate-path" }), /already exists/);
  const saved = await call("page_read", { path: args.path }) as { frontmatter: { title: string }; content: string };
  assert.equal(saved.frontmatter.title, "Memo"); assert.match(saved.content, /Updated/);
  const activity = await call("activity_list") as { operations: Array<{ tool: string; status: string }> };
  assert.ok(activity.operations.some(r => r.tool === "page_patch" && r.status === "completed"));
});

test("search and listing return source references and pagination", async () => {
  const listing = await call("page_list", { limit: 1 }) as { pages: unknown[]; nextOffset: number };
  assert.equal(listing.pages.length, 1); assert.equal(listing.nextOffset, 1);
  const search = await call("knowledge_search", { query: "filing" }) as { matches: Array<{ path: string; revision: string }> };
  assert.equal(search.matches[0].path, "research/memo.md");
  assert.equal(search.matches[0].revision.length, 64);
  const context = await call("cabinet_context") as { instructions: Array<{ content: string }> };
  assert.match(context.instructions[0].content, /Keep source references/);
});

test("descendant symlinks cannot expand a content grant", async () => {
  await fs.writeFile(path.join(temporary, "secret.md"), "secret");
  await fs.symlink(path.join(temporary, "secret.md"), path.join(DATA_DIR, cabinet, "linked.md"));
  await assert.rejects(call("page_read", { path: "linked.md" }), /outside this MCP/);
  await assert.rejects(call("page_patch", { path: "linked.md", content: "overwrite", expectedRevision: "x", requestId: "symlink-write" }), /outside this MCP/);
  assert.equal(await fs.readFile(path.join(temporary, "secret.md"), "utf8"), "secret");
});

test("revision checks serialize with Cabinet's shared page writer", async () => {
  const page = "concurrent.md";
  const created = await call("page_create", { path: page, title: "Concurrent", content: "Original", requestId: "concurrent-create" }) as { revision: string };
  const fullPath = `${cabinet}/${page}`;
  const outcomes = await Promise.allSettled([
    writePage(fullPath, "First", { title: "Concurrent" }, { expectedRevision: created.revision }),
    writePage(fullPath, "Second", { title: "Concurrent" }, { expectedRevision: created.revision }),
  ]);
  assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
  const rejected = outcomes.find(r => r.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof PageWriteConflict);
  const saved = await call("page_read", { path: page }) as { content: string };
  assert.match(saved.content, /First|Second/);
});
