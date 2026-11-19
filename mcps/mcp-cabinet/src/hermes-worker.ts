import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig, readRun, runDir, writeRun } from "./hermes-state.js";

async function main() {
  const { config } = await loadConfig();
  const run = await readRun(config, process.argv[2]);
  const dir = runDir(config, run.id);
  const output = await fs.open(path.join(dir, "output.txt"), "w", 0o600);
  const errors = await fs.open(path.join(dir, "stderr.txt"), "w", 0o600);
  let cancelled = false, timedOut = false;
  try {
    if (await fs.stat(path.join(dir, "cancel")).then(() => true, () => false)) {
      await writeRun(config, { ...run, status: "cancelled", completedAt: new Date().toISOString() }); return;
    }
    const child = spawn(config.command, ["chat", "--query-file", path.join(dir, "prompt.txt"), "--quiet", "--oneshot", "--source", "tool", "--max-turns", String(config.maxTurns), "--run-budget", String(config.timeoutSeconds)], {
      cwd: config.cwd, detached: true, stdio: ["ignore", output.fd, errors.fd], env: { ...process.env, HERMES_HOME: config.profileHome, CABINET_MCP_DELEGATION_DEPTH: "1" },
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* process already exited */ }
      if (!killTimer) killTimer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* process already exited */ } }, 3000);
    };
    const timeout = setTimeout(() => { timedOut = true; stop(); }, config.timeoutSeconds * 1000 + 5000);
    const cancellation = setInterval(() => { void fs.stat(path.join(dir, "cancel")).then(() => { cancelled = true; stop(); }, () => {}); }, 500);
    try {
      const exit = new Promise<number | null>((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
      // A spawn error can arrive while the initial metadata write is pending.
      void exit.catch(() => {});
      await writeRun(config, { ...run, status: "running", workerPid: process.pid, pid: child.pid });
      const exitCode = await exit;
      await writeRun(config, { ...run, status: cancelled ? "cancelled" : exitCode === 0 && !timedOut ? "completed" : "failed", completedAt: new Date().toISOString(), exitCode, ...(timedOut ? { error: "Hermes run exceeded its time budget" } : {}) });
    } catch (error) {
      // If persisting state fails, never leave an untracked agent running.
      if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* process already exited */ } }
      throw error;
    } finally { clearTimeout(timeout); clearInterval(cancellation); if (killTimer) clearTimeout(killTimer); }
  } catch (error) {
    await writeRun(config, { ...run, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Hermes worker failed" });
  } finally { await output.close(); await errors.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
