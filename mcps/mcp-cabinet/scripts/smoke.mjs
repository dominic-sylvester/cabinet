import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-mcp-smoke-"));
const clients = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(entry, env) {
  const client = new Client({ name: "cabinet-smoke", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist", entry)], env: { ...process.env, ...env }, stderr: "pipe" });
  await client.connect(transport); clients.push(client); return client;
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return { error: result.isError === true, value: JSON.parse(result.content[0].text) };
}
async function untilTerminal(client, id) {
  for (let i = 0; i < 120; i++) {
    const result = await call(client, "hermes_run_status", { runId: id });
    if (["completed", "failed", "cancelled"].includes(result.value.status)) return result.value;
    await delay(100);
  }
  throw new Error("Run did not finish");
}
let gateway;
try {
  gateway = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-token");
    assert.equal(req.url, "/api/mcp");
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    if (body.tool === "tools_list") res.end(JSON.stringify({ tools: [{ name: "cabinet_list", description: "List cabinets", inputSchema: { type: "object", properties: {} } }] }));
    else res.end(JSON.stringify({ result: { cabinets: [{ cabinetPath: "research" }] } }));
  });
  await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
  const cabinetFile = path.join(tmp, "cabinet.json");
  await fs.writeFile(cabinetFile, JSON.stringify({ url: `http://127.0.0.1:${gateway.address().port}/api/mcp`, token: "test-token" }), { mode: 0o600 });
  const cabinet = await connect("index.js", { CABINET_MCP_CONNECTION: cabinetFile });
  assert.equal((await cabinet.listTools()).tools[0].name, "cabinet_list");
  assert.equal((await call(cabinet, "cabinet_list", {})).value.cabinets[0].cabinetPath, "research");

  const executable = path.join(tmp, "fake-hermes");
  await fs.writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (!args.includes('--oneshot') || !args.includes('--quiet') || args.includes('--yolo') || process.env.CABINET_MCP_DELEGATION_DEPTH !== '1') process.exit(4);
fs.appendFileSync(path.join(__dirname, 'calls'), 'called\\n');
const prompt = fs.readFileSync(args[args.indexOf('--query-file')+1], 'utf8');
if (prompt === 'WAIT') setInterval(() => {}, 1000);
else setTimeout(() => { console.log('Result: ' + prompt); }, 700);
`, { mode: 0o700 });
  const hermesFile = path.join(tmp, "hermes.json");
  const stateDir = path.join(tmp, "state");
  await fs.writeFile(hermesFile, JSON.stringify({ command: executable, profileHome: tmp, cwd: tmp, stateDir, timeoutSeconds: 3, maxTurns: 5 }), { mode: 0o600 });
  const env = { CABINET_HERMES_CONNECTION: hermesFile, CABINET_MCP_DELEGATION_DEPTH: "0" };
  const first = await connect("hermes.js", env);
  assert.equal((await first.listTools()).tools.length, 4);
  const started = await call(first, "hermes_run_start", { prompt: "Research with $(literal) and `literal`", requestId: "research-1" });
  assert.equal(started.error, false);
  await first.close();
  const second = await connect("hermes.js", env);
  const replay = await call(second, "hermes_run_start", { requestId: "research-1", prompt: "Research with $(literal) and `literal`" });
  assert.deepEqual(replay.value, started.value);
  assert.equal((await untilTerminal(second, started.value.runId)).status, "completed");
  const result = await call(second, "hermes_run_result", { runId: started.value.runId });
  assert.match(result.value.output, /\$\(literal\) and `literal`/);
  assert.equal((await fs.readFile(path.join(tmp, "calls"), "utf8")).trim().split("\n").length, 1);
  const conflict = await call(second, "hermes_run_start", { prompt: "changed", requestId: "research-1" });
  assert.equal(conflict.error, true);
  const running = await call(second, "hermes_run_start", { prompt: "WAIT", requestId: "cancel-me" });
  const busy = await call(second, "hermes_run_start", { prompt: "new", requestId: "busy" });
  assert.equal(busy.error, true);
  await call(second, "hermes_run_cancel", { runId: running.value.runId });
  assert.equal((await untilTerminal(second, running.value.runId)).status, "cancelled");
  const nested = await connect("hermes.js", { ...env, CABINET_MCP_DELEGATION_DEPTH: "1" });
  assert.equal((await call(nested, "hermes_run_start", { prompt: "recursive", requestId: "recursive" })).error, true);
  assert.equal((await call(second, "hermes_run_result", { runId: "../../secret" })).error, true);
  const timeout = await call(second, "hermes_run_start", { prompt: "WAIT", requestId: "timeout" });
  const timedOut = await untilTerminal(second, timeout.value.runId);
  assert.equal(timedOut.status, "failed"); assert.match(timedOut.error, /time budget/);
  const badConfigFile = path.join(tmp, "bad-hermes.json");
  await fs.writeFile(badConfigFile, JSON.stringify({ command: path.join(tmp, "missing-hermes"), profileHome: tmp, cwd: tmp, stateDir: path.join(tmp, "bad-state"), timeoutSeconds: 3, maxTurns: 5 }), { mode: 0o600 });
  const badClient = await connect("hermes.js", { ...env, CABINET_HERMES_CONNECTION: badConfigFile });
  const failed = await call(badClient, "hermes_run_start", { prompt: "Never executes", requestId: "missing-executable" });
  assert.equal((await untilTerminal(badClient, failed.value.runId)).status, "failed");
  console.log("Passed: Cabinet stdio transport/auth, Hermes asynchronous delegation, disconnect recovery, retry deduplication, conflict rejection, cancellation, recursion guard, path validation, hard timeout, and missing-executable recovery. No real provider was called.");
} finally {
  await Promise.allSettled(clients.map(client => client.close()));
  if (gateway) await new Promise(resolve => gateway.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
}
