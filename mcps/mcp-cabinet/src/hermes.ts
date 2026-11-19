import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { serve } from "./server.js";
import { loadConfig, readRun, runDir, writeRun, type HermesRun } from "./hermes-state.js";
import { McpState, atomicJson } from "../../../src/lib/mcp/state.ts";
import { McpError } from "../../../src/lib/mcp/contracts.ts";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const tools: Tool[] = [
  { name: "hermes_run_start", description: "Delegate work to a local Hermes agent asynchronously. Returns a durable run ID; use the same requestId for retries. Hermes uses the configured profile's model and normal tool permissions. One active delegation at a time.", inputSchema: { type: "object", properties: { prompt: { type: "string", maxLength: 50000 }, requestId: { type: "string", maxLength: 128 } }, required: ["prompt", "requestId"], additionalProperties: false } },
  { name: "hermes_run_status", description: "Read a durable Hermes run's status.", inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"], additionalProperties: false } },
  { name: "hermes_run_result", description: "Read final Hermes output, with pagination.", inputSchema: { type: "object", properties: { runId: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50000 } }, required: ["runId"], additionalProperties: false } },
  { name: "hermes_run_cancel", description: "Request cancellation of a delegated Hermes run.", inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"], additionalProperties: false } },
];
async function main() {
  const { config, file } = await loadConfig();
  const state = new McpState(config.stateDir);
  const owner = { id: "hermes", cabinets: ["."], permissions: [], tokenHash: "", createdAt: "" };
  await serve("hermes-local", async () => tools, async (name, args) => {
    const spec = tools.find(t => t.name === name);
    if (!spec) throw new Error("Unknown Hermes tool");
    const allowed = Object.keys(spec.inputSchema.properties ?? {});
    if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error("Unknown argument");
    if (name === "hermes_run_start") {
      if (Number(process.env.CABINET_MCP_DELEGATION_DEPTH ?? 0) > 0) throw new Error("Nested Hermes delegation is disabled");
      if (typeof args.prompt !== "string" || !args.prompt.trim() || args.prompt.length > 50000 || typeof args.requestId !== "string") throw new Error("prompt and requestId are required");
      return state.once(owner, args.requestId, name, ".", args, () => state.locked("active-hermes", async () => {
        const activeFile = path.join(config.stateDir, "active.json");
        const active = await fs.readFile(activeFile, "utf8").then(raw => JSON.parse(raw) as { id: string }).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
        if (active && ["queued", "running"].includes((await readRun(config, active.id)).status)) throw new McpError("delegation_busy", "A Hermes delegation is already active; inspect or cancel it first", 409);
        const run: HermesRun = { id: randomUUID(), requestId: args.requestId as string, status: "queued", createdAt: new Date().toISOString() };
        const dir = runDir(config, run.id);
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        await fs.writeFile(path.join(dir, "prompt.txt"), args.prompt as string, { mode: 0o600, flag: "wx" });
        await writeRun(config, run);
        await atomicJson(activeFile, { id: run.id });
        const worker = spawn(process.execPath, [fileURLToPath(new URL("./hermes-worker.js", import.meta.url)), run.id], { detached: true, stdio: "ignore", env: { ...process.env, CABINET_HERMES_CONNECTION: file } });
        await new Promise<void>((resolve, reject) => { worker.once("spawn", resolve); worker.once("error", reject); });
        worker.unref();
        return { runId: run.id, status: "queued" };
      }));
    }
    if (typeof args.runId !== "string") throw new Error("runId is required");
    const run = await readRun(config, args.runId);
    if (name === "hermes_run_status") return run;
    if (name === "hermes_run_cancel") {
      if (["queued", "running"].includes(run.status)) await fs.writeFile(path.join(runDir(config, run.id), "cancel"), "", { mode: 0o600 });
      return { runId: run.id, status: run.status, cancellationRequested: ["queued", "running"].includes(run.status) };
    }
    const offset = args.offset ?? 0, limit = args.limit ?? 50000;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50000) throw new Error("Invalid pagination");
    const output = await fs.readFile(path.join(runDir(config, run.id), "output.txt"), "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return ""; throw e; });
    return { ...run, output: output.slice(offset, offset + limit), totalCharacters: output.length, nextOffset: offset + limit < output.length ? offset + limit : null };
  });
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
