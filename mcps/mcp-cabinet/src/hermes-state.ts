import fs from "node:fs/promises";
import path from "node:path";
import { atomicJson, assertId } from "../../../src/lib/mcp/state.ts";

export interface HermesConfig { command: string; profileHome: string; cwd: string; stateDir: string; timeoutSeconds: number; maxTurns: number }
export interface HermesRun {
  id: string; requestId: string; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string; completedAt?: string; pid?: number; workerPid?: number; exitCode?: number | null; error?: string;
}
export async function loadConfig() {
  const file = process.env.CABINET_HERMES_CONNECTION;
  if (!file) throw new Error("Set CABINET_HERMES_CONNECTION to the private Hermes bridge configuration");
  const config: HermesConfig = JSON.parse(await fs.readFile(file, "utf8"));
  if (![config.command, config.profileHome, config.cwd, config.stateDir].every(p => typeof p === "string" && path.isAbsolute(p)) || !Number.isInteger(config.timeoutSeconds) || config.timeoutSeconds < 1 || config.timeoutSeconds > 3600 || !Number.isInteger(config.maxTurns) || config.maxTurns < 1 || config.maxTurns > 500) throw new Error("Invalid Hermes bridge configuration");
  return { config, file };
}
export const runDir = (config: HermesConfig, id: string) => path.join(config.stateDir, "runs", assertId(id));
export async function readRun(config: HermesConfig, id: string): Promise<HermesRun> {
  return JSON.parse(await fs.readFile(path.join(runDir(config, id), "run.json"), "utf8"));
}
export async function writeRun(config: HermesConfig, run: HermesRun) { await atomicJson(path.join(runDir(config, run.id), "run.json"), run); }
