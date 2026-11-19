import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DATA_DIR } from "../src/lib/storage/path-utils";
import { getAppOrigin, PROJECT_ROOT } from "../src/lib/runtime/runtime-config";
import { mcpState } from "../src/lib/mcp/gateway";
import { atomicJson, cleanPath } from "../src/lib/mcp/state";
import { discoverCabinetPaths } from "../src/lib/cabinets/discovery";
import { getCatalogEntry } from "../src/lib/agents/mcp-catalog";
import { writeEntry } from "../src/lib/agents/mcp-config-writer";
import { upsertCabinetEnv } from "../src/lib/runtime/cabinet-env";
import { getMcpProvider } from "../src/lib/agents/mcp-providers";

async function main() {
  const args = process.argv.slice(2);
  const values = (flag: string) => args.flatMap((value, i) => value === flag && args[i + 1] ? [args[i + 1]] : []);
  if (args.includes("--list")) { console.log(JSON.stringify({ dataDir: DATA_DIR, cabinets: await discoverCabinetPaths() }, null, 2)); return; }
  const cabinets = values("--cabinet");
  if (!cabinets.length) throw new Error("Specify --cabinet PATH (repeatable). Use --list to discover cabinets.");
  const known = await discoverCabinetPaths();
  for (const cp of cabinets) if (!known.includes(cleanPath(cp, true))) throw new Error(`Unknown cabinet: ${cp}`);
  const providers = values("--provider");
  for (const provider of providers) if (!getMcpProvider(provider)?.mcpConfig) throw new Error(`Unsupported MCP environment: ${provider}`);
  const name = values("--name")[0] ?? "hermes";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw new Error("Invalid connection name");
  const profileHome = path.resolve(values("--hermes-home")[0] ?? process.env.HERMES_HOME ?? path.join(os.homedir(), ".hermes"));
  await fs.access(path.join(profileHome, "config.yaml"));
  const command = values("--hermes-command")[0] ?? path.join(os.homedir(), ".local/bin/hermes");
  if (!path.isAbsolute(command)) throw new Error("Use an absolute --hermes-command path");
  await fs.access(command);
  await fs.access(path.join(PROJECT_ROOT, "mcps/mcp-cabinet/dist/index.js"));
  await fs.access(path.join(PROJECT_ROOT, "mcps/mcp-cabinet/dist/hermes-worker.js"));
  const dir = path.join(os.homedir(), ".cabinet", "mcp", name);
  const cabinetFile = path.join(dir, "cabinet.json"), hermesFile = path.join(dir, "hermes.json");
  if (await fs.stat(cabinetFile).then(() => true, () => false) || await fs.stat(hermesFile).then(() => true, () => false)) throw new Error("Connection files already exist. Choose another --name or reuse the existing files.");
  const { token } = await mcpState.provision(name, cabinets, ["read", "write", "tasks", "execute"]);
  await atomicJson(cabinetFile, { url: `${getAppOrigin()}/api/mcp`, token });
  await atomicJson(hermesFile, { command, profileHome, cwd: await fs.realpath(path.join(DATA_DIR, cabinets[0])), stateDir: path.join(dir, "hermes-runs"), timeoutSeconds: 900, maxTurns: 60 });
  if (providers.length) upsertCabinetEnv("CABINET_HERMES_CONNECTION", hermesFile);
  const entry = getCatalogEntry("hermes")!;
  const results = providers.map(provider => writeEntry(provider, { ...entry, serverEnv: { CABINET_HERMES_CONNECTION: hermesFile } }));
  console.log(JSON.stringify({ cabinetFile, hermesFile, profileHome, cabinets, providers: results,
    hermesMcpCommand: { command: process.execPath, args: [path.join(PROJECT_ROOT, "mcps/mcp-cabinet/dist/index.js")], env: { CABINET_MCP_CONNECTION: cabinetFile } },
    note: "Add the Cabinet server with hermes mcp add in this profile. New sessions discover the connection. No agent has been executed." }, null, 2));
  if (results.some(r => !r.ok)) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
