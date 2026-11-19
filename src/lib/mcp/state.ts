import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { McpError, type McpPermission } from "./contracts";

export interface McpConnection {
  id: string;
  tokenHash: string;
  cabinets: string[];
  permissions: McpPermission[];
  createdAt: string;
}
export interface Receipt {
  requestId: string;
  tool: string;
  cabinetPath: string;
  fingerprint: string;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  result?: unknown;
  error?: { code: string; message: string };
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const safeId = /^[a-zA-Z0-9_-]{1,240}$/;
export function assertId(value: string): string {
  if (!safeId.test(value)) throw new McpError("invalid_id", "Invalid identifier");
  return value;
}
export function cleanPath(value: string, allowRoot = false): string {
  if (allowRoot && value === ".") return value;
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || value.split("/").some(s => !s || s === "." || s === ".." || s.startsWith("."))) throw new McpError("invalid_path", "Use a relative content path without hidden or parent segments");
  return value;
}
async function privateDir(dir: string) { await fs.mkdir(dir, { recursive: true, mode: 0o700 }); }
export async function atomicJson(file: string, value: unknown) {
  await privateDir(path.dirname(file));
  const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  await fs.rename(temporary, file);
}
export class McpState {
  constructor(public readonly root: string) {}
  async provision(id: string, cabinets: string[], permissions: McpPermission[]): Promise<{ connection: McpConnection; token: string }> {
    assertId(id);
    if (!cabinets.length || !permissions.length || permissions.some(p => !["read", "write", "tasks", "execute"].includes(p))) throw new McpError("invalid_grant", "Cabinets and valid permissions are required");
    cabinets.forEach(cp => cleanPath(cp, true));
    const token = randomBytes(32).toString("hex");
    const connection: McpConnection = { id, cabinets, permissions, tokenHash: digest(token), createdAt: new Date().toISOString() };
    const dir = path.join(this.root, "connections");
    await privateDir(dir);
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(connection, null, 2), { flag: "wx", mode: 0o600 });
    return { connection, token };
  }
  async authenticate(token: string): Promise<McpConnection> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new McpError("unauthorized", "Invalid MCP connection", 401);
    const dir = path.join(this.root, "connections");
    const entries = await fs.readdir(dir).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
    for (const name of entries.filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n))) {
      const c: McpConnection = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      if (/^[a-f0-9]{64}$/.test(c.tokenHash) && timingSafeEqual(Buffer.from(c.tokenHash, "hex"), Buffer.from(digest(token), "hex"))) return c;
    }
    throw new McpError("unauthorized", "Invalid MCP connection", 401);
  }
  connectionDir(c: McpConnection) { return path.join(this.root, "operations", assertId(c.id)); }
  async receipts(c: McpConnection): Promise<Receipt[]> {
    const dir = this.connectionDir(c);
    const names = await fs.readdir(dir).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
    const receipts = await Promise.all(names.filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => fs.readFile(path.join(dir, n), "utf8").then(raw => JSON.parse(raw) as Receipt)));
    return receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async once(c: McpConnection, requestId: string, tool: string, cabinetPath: string, args: unknown, action: (checkpoint: (result: unknown) => Promise<void>) => Promise<unknown>): Promise<unknown> {
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(requestId)) throw new McpError("invalid_request_id", "Invalid requestId");
    const file = path.join(this.connectionDir(c), `${digest(requestId)}.json`);
    const canonical = JSON.stringify(args, Object.keys(args as object).sort());
    const fingerprint = digest(`${tool}\n${cabinetPath}\n${canonical}`);
    const receipt: Receipt = { requestId, tool, cabinetPath, fingerprint, status: "pending", createdAt: new Date().toISOString() };
    await privateDir(path.dirname(file));
    try { await fs.writeFile(file, JSON.stringify(receipt), { flag: "wx", mode: 0o600 }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const previous: Receipt = JSON.parse(await fs.readFile(file, "utf8"));
      if (previous.fingerprint !== fingerprint) throw new McpError("request_conflict", "requestId was already used for different arguments", 409);
      if (previous.status === "completed") return previous.result;
      if (previous.status === "failed") throw new McpError(previous.error!.code, previous.error!.message, 409);
      throw new McpError("outcome_pending", "Operation is in progress or its outcome needs inspection. Do not retry with a new requestId; inspect activity_list.", 409);
    }
    try {
      const result = await action(async result => {
        receipt.result = result;
        await atomicJson(file, receipt);
      });
      await atomicJson(file, { ...receipt, status: "completed", result });
      return result;
    } catch (e) {
      const error = e instanceof McpError ? e : new McpError("operation_failed", "Operation failed; inspect local diagnostics before issuing another request");
      await atomicJson(file, { ...receipt, status: "failed", error: { code: error.code, message: error.message } });
      throw error;
    }
  }
  async locked<T>(key: string, action: () => Promise<T>): Promise<T> {
    const dir = path.join(this.root, "locks");
    await privateDir(dir);
    const file = path.join(dir, digest(key));
    let handle;
    try { handle = await fs.open(file, "wx", 0o600); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new McpError("resource_busy", "Resource is busy. A lock left by an interrupted process requires inspection.", 409); throw e; }
    try { return await action(); }
    finally { await handle.close(); await fs.unlink(file); }
  }
}
