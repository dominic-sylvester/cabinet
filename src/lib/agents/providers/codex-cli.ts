import fs from "fs";
import os from "os";
import path from "path";
import type {
  AgentProvider,
  ProviderEffortLevel,
  ProviderModel,
  ProviderStatus,
} from "../provider-interface";
import {
  buildCommandCandidates,
  checkCliProviderAvailable,
  execCli,
  resolveCliCommand,
} from "../provider-cli";

// Codex on Amazon Bedrock requires vendor-prefixed model IDs (e.g.
// `openai.gpt-5.5`), but our model picker exposes the OpenAI-direct IDs
// (`gpt-5.5`). When the user has configured `model_provider = "amazon-bedrock"`
// in ~/.codex/config.toml, prefix outgoing `--model` values so Bedrock's
// router accepts them. Cached because config.toml rarely changes mid-process.
function readCodexConfigBedrockMode(): boolean {
  try {
    const home = process.env.HOME || os.homedir();
    if (!home) return false;
    const configPath = path.join(home, ".codex", "config.toml");
    const text = fs.readFileSync(configPath, "utf8");
    // Only consider the top-level `model_provider` key — i.e. assignments
    // before the first `[section]` header. A `model_provider` set inside a
    // profile or other table doesn't determine the default provider for
    // runs that don't activate that table, so trusting it here would
    // wrongly Bedrock-namespace --model for non-Bedrock runs.
    const topLevel = text.split(/^\s*\[/m, 1)[0] ?? "";
    return /^\s*model_provider\s*=\s*["']amazon-bedrock["']/m.test(topLevel);
  } catch {
    return false;
  }
}

let cachedBedrockMode: boolean | null = null;
function isCodexBedrockMode(): boolean {
  if (cachedBedrockMode === null) {
    cachedBedrockMode = readCodexConfigBedrockMode();
  }
  return cachedBedrockMode;
}

// Known Bedrock vendor prefixes — used to detect whether a model id was
// already supplied in Bedrock-namespaced form (so we don't double-prefix).
// Version-style dots like `gpt-5.5` are NOT vendor prefixes.
const BEDROCK_VENDOR_PREFIXES = ["openai.", "anthropic.", "amazon.", "meta.", "cohere.", "ai21.", "mistral."];

export function applyBedrockModelPrefix(model: string): string {
  if (!isCodexBedrockMode()) return model;
  if (BEDROCK_VENDOR_PREFIXES.some((p) => model.startsWith(p))) return model;
  return `openai.${model}`;
}

const CODEX_REASONING_LEVELS = [
  { id: "low", name: "Low", description: "Faster, lighter reasoning" },
  { id: "medium", name: "Medium", description: "Balanced depth" },
  { id: "high", name: "High", description: "More deliberate reasoning" },
] as const;

const CODEX_EXTENDED_REASONING_LEVELS = [
  ...CODEX_REASONING_LEVELS,
  {
    id: "xhigh",
    name: "Extra High",
    description: "Maximum depth for the hardest tasks",
  },
] as const;

const CODEX_MAX_REASONING_LEVELS = [
  { id: "none", name: "None", description: "Skip extra reasoning tokens" },
  { id: "medium", name: "Medium", description: "Balanced depth" },
  { id: "high", name: "High", description: "More deliberate reasoning" },
  {
    id: "xhigh",
    name: "Extra High",
    description: "Maximum depth for the hardest tasks",
  },
] as const;

// Effort rungs as `codex debug models` reports them for the current
// generation (through `ultra`); the fast/cheap variants stop at `max`.
const CODEX_CATALOG_REASONING_LEVELS = [
  {
    id: "low",
    name: "Low",
    description: "Fast responses with lighter reasoning",
  },
  {
    id: "medium",
    name: "Medium",
    description: "Balances speed and reasoning depth for everyday tasks",
  },
  {
    id: "high",
    name: "High",
    description: "Greater reasoning depth for complex problems",
  },
  {
    id: "xhigh",
    name: "Extra High",
    description: "Extra high reasoning depth for complex problems",
  },
  {
    id: "max",
    name: "Max",
    description: "Maximum reasoning depth for the hardest problems",
  },
  {
    id: "ultra",
    name: "Ultra",
    description: "Maximum reasoning with automatic task delegation",
  },
] as const;

const CODEX_CATALOG_REASONING_LEVELS_NO_ULTRA =
  CODEX_CATALOG_REASONING_LEVELS.filter((level) => level.id !== "ultra");

const EFFORT_LEVEL_NAMES: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

function effortLevelName(effort: string): string {
  const known = EFFORT_LEVEL_NAMES[effort];
  if (known) return known;
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function parseCodexEffortLevels(raw: unknown): ProviderEffortLevel[] {
  if (!Array.isArray(raw)) return [];
  const levels: ProviderEffortLevel[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { effort?: unknown; description?: unknown };
    const id = typeof record.effort === "string" ? record.effort.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : undefined;
    levels.push({
      id,
      name: effortLevelName(id),
      ...(description ? { description } : {}),
    });
  }
  return levels;
}

/**
 * Pure parser for `codex debug models` stdout — the CLI's own catalog (the same
 * payload it caches at `~/.codex/models_cache.json`), which is *ahead* of any
 * hardcoded list this app ships. Hidden entries (`gpt-reserve`,
 * `codex-auto-review`) are internal aliases the CLI resolves itself, so they
 * are dropped: offering them in a picker invites dead selections.
 *
 * Empty/unparseable output returns `[]` so the caller can decide to fall back
 * to the static list with an honest `dynamic: false`.
 */
export function parseCodexModels(
  stdout: string | null | undefined,
): ProviderModel[] {
  const text = (stdout || "").trim();
  if (!text) return [];
  // Tolerate CLI chrome before the JSON payload (warnings, `Reading ...`).
  const start = text.indexOf("{");
  if (start === -1) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(text.slice(start));
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { models?: unknown }).models;
  if (!Array.isArray(raw)) return [];

  const models: ProviderModel[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as {
      slug?: unknown;
      display_name?: unknown;
      description?: unknown;
      visibility?: unknown;
      supported_reasoning_levels?: unknown;
    };
    const id = typeof record.slug === "string" ? record.slug.trim() : "";
    if (!id || seen.has(id)) continue;
    if (record.visibility === "hide") continue;
    seen.add(id);

    const displayName =
      typeof record.display_name === "string" && record.display_name.trim()
        ? record.display_name.trim()
        : id;
    const description =
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : undefined;
    const effortLevels = parseCodexEffortLevels(
      record.supported_reasoning_levels,
    );

    models.push({
      id,
      name: displayName,
      ...(description ? { description } : {}),
      ...(effortLevels.length > 0 ? { effortLevels } : {}),
    });
  }

  return models;
}

/**
 * Offline fallback catalog, refreshed from `codex debug models` (Codex
 * 0.167.2, 2026-11-13). Only used when live discovery fails — a live
 * `listModels()` result wins, so this list going stale degrades to "the
 * models we knew about at build time", never to an empty picker.
 */
const CODEX_CURRENT_MODELS: ProviderModel[] = [
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1-Sol",
    description: "Latest workhorse model for coding and everyday work.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS],
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6-Astra",
    description: "Frontier intelligence for the most demanding work.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS],
  },
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    description: "GPT-6.1 Terra Codex model.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS],
  },
  {
    id: "gpt-6-sol",
    name: "GPT-6-Sol",
    description: "Previous generation workhorse model.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS],
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6-Luna",
    description: "Fast and affordable model for easier tasks.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS_NO_ULTRA],
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6-Sol",
    description: "Older generation workhorse model.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS],
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6-Terra",
    description: "Older balanced model for straightforward work.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS],
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6-Luna",
    description: "Older fast and efficient model.",
    effortLevels: [...CODEX_CATALOG_REASONING_LEVELS_NO_ULTRA],
  },
];

export const codexCliProvider: AgentProvider = {
  id: "codex-cli",
  name: "Codex CLI",
  type: "cli",
  icon: "bot",
  installMessage: "Codex CLI not found. Install with: npm i -g @openai/codex",
  installSteps: [
    { title: "Install Codex CLI", detail: "Run the following in your terminal:", command: "npm i -g @openai/codex" },
    { title: "Log in", detail: "Authenticate with your ChatGPT or API account:", command: "codex login" },
    { title: "Verify login", detail: "Check that you're logged in:", command: "codex login status" },
    { title: "Verify setup", detail: "Confirm headless mode works:", command: "codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox 'Reply with exactly OK'" },
  ],
  detachedPromptLaunchMode: "one-shot",
  // The picker's real list comes from `listModels()` below (live
  // `codex debug models`). This array is the *offline* fallback the models API
  // route serves when that probe fails: the current generation first, then
  // legacy ids annotated with `requires` so pickers can badge entries the
  // user's current auth mode can't hit. Per OpenAI's Codex models docs
  // (verified 2026-05-03): `gpt-5.5` and `gpt-5.3-codex-spark` are
  // ChatGPT-only; the older `*-codex` / `o*` / `gpt-4.1*` ids are API-key
  // only; the `gpt-5.4`/`gpt-5.4-mini`/`gpt-5.3-codex`/`gpt-5.2` line works
  // with both auth modes.
  models: [
    ...CODEX_CURRENT_MODELS,
    {
      id: "gpt-5.5",
      name: "GPT-5.5",
      description: "Recommended default: strongest coding model (ChatGPT sign-in only)",
      requires: "chatgpt_plan",
      effortLevels: [...CODEX_EXTENDED_REASONING_LEVELS],
    },
    {
      id: "gpt-5.4",
      name: "GPT-5.4",
      description: "Previous flagship, works with both ChatGPT and API key",
      requires: "any",
      effortLevels: [...CODEX_EXTENDED_REASONING_LEVELS],
    },
    {
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      description: "Faster, lower-cost variant for lighter coding tasks",
      requires: "any",
      effortLevels: [...CODEX_EXTENDED_REASONING_LEVELS],
    },
    {
      id: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      description: "Codex-tuned model for agentic coding",
      requires: "any",
      effortLevels: [...CODEX_EXTENDED_REASONING_LEVELS],
    },
    {
      id: "gpt-5.3-codex-spark",
      name: "GPT-5.3 Codex Spark",
      description: "Real-time coding iteration (ChatGPT Pro research preview)",
      requires: "chatgpt_plan",
      effortLevels: [...CODEX_REASONING_LEVELS],
    },
    {
      id: "gpt-5.2",
      name: "GPT-5.2",
      description: "General-purpose GPT-5.2",
      requires: "any",
      effortLevels: [...CODEX_EXTENDED_REASONING_LEVELS],
    },
    {
      id: "gpt-5.2-codex",
      name: "GPT-5.2 Codex",
      description: "Earlier Codex flagship (API-key only)",
      requires: "api_key",
      effortLevels: [...CODEX_EXTENDED_REASONING_LEVELS],
    },
    {
      id: "gpt-5.1-codex-max",
      name: "GPT-5.1 Codex Max",
      description: "High-depth Codex model with extended reasoning (API-key only)",
      requires: "api_key",
      effortLevels: [...CODEX_MAX_REASONING_LEVELS],
    },
    {
      id: "o3",
      name: "o3",
      description: "Most capable legacy reasoning model (API-key only)",
      requires: "api_key",
      effortLevels: [...CODEX_REASONING_LEVELS],
    },
    {
      id: "o4-mini",
      name: "o4-mini",
      description: "Fast legacy reasoning model (API-key only)",
      requires: "api_key",
      effortLevels: [...CODEX_REASONING_LEVELS],
    },
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      description: "Flagship GPT model (API-key only)",
      requires: "api_key",
      effortLevels: [],
    },
    {
      id: "gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      description: "Fast and affordable (API-key only)",
      requires: "api_key",
      effortLevels: [],
    },
    {
      id: "gpt-4.1-nano",
      name: "GPT-4.1 Nano",
      description: "Fastest, lowest cost (API-key only)",
      requires: "api_key",
      effortLevels: [],
    },
  ],
  effortLevels: [
    { id: "none", name: "None", description: "Skip extra reasoning tokens" },
    { id: "low", name: "Low", description: "Faster, lighter reasoning" },
    { id: "medium", name: "Medium", description: "Balanced depth" },
    { id: "high", name: "High", description: "More deliberate reasoning" },
    {
      id: "xhigh",
      name: "Extra High",
      description: "Maximum depth for the hardest tasks",
    },
  ],
  command: "codex",
  commandCandidates: buildCommandCandidates("codex"),

  buildArgs(prompt: string, _workdir: string): string[] {
    return [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      prompt,
    ];
  },

  buildOneShotInvocation(prompt: string, workdir: string, opts) {
    const baseArgs = this.buildArgs ? this.buildArgs(prompt, workdir) : [];
    const args = [...baseArgs];
    if (opts?.model) {
      args.unshift("--model", applyBedrockModelPrefix(opts.model));
    }
    if (opts?.effort) {
      args.unshift("-c", `model_reasoning_effort=${opts.effort}`);
    }
    return {
      command: this.command || "codex",
      args,
    };
  },

  buildSessionInvocation(
    prompt: string | undefined,
    _workdir: string,
    opts
  ) {
    // Interactive TUI mode. Previously this wrapped the prompt with
    // `buildArgs` which produces `codex exec … <prompt>` — but `codex exec`
    // is the HEADLESS one-shot subcommand, so users who picked "terminal
    // mode" were getting the non-interactive run piped through a PTY. The
    // interactive TUI is invoked with no subcommand (bare `codex`), and the
    // daemon pastes `initialPrompt` into the TUI once it's ready.
    const args: string[] = [];
    if (opts?.resumeId) {
      // `codex resume <session-id>` rehydrates a prior interactive session.
      args.push("resume", opts.resumeId);
    }
    return {
      command: this.command || "codex",
      args,
      initialPrompt: prompt?.trim() || undefined,
    };
  },

  // Live discovery: `codex debug models` renders the CLI's own catalog, so a
  // model released after this app build shows up in the composer without an
  // app update. Throws on a genuine CLI failure (missing binary, not runnable,
  // empty catalog) — the models API route catches that and serves the static
  // fallback with `dynamic: false` so the picker can say "offline defaults".
  async listModels(): Promise<ProviderModel[]> {
    const command = resolveCliCommand(this);
    const stdout = await execCli(command, ["debug", "models"], { timeout: 20_000 });
    const models = parseCodexModels(stdout);
    if (models.length === 0) {
      throw new Error("codex debug models returned no models");
    }
    return models;
  },

  async isAvailable(): Promise<boolean> {
    return checkCliProviderAvailable(this);
  },

  async healthCheck(): Promise<ProviderStatus> {
    try {
      const available = await this.isAvailable();
      if (!available) {
        return {
          available: false,
          authenticated: false,
          error: this.installMessage,
        };
      }

      // Check auth status via `codex login status`
      try {
        const cmd = resolveCliCommand(this);
        const output = await execCli(cmd, ["login", "status"], {
          timeout: 5000,
          captureStderr: true,
        });

        // Output is e.g. "Logged in using ChatGPT"
        if (output.toLowerCase().startsWith("logged in")) {
          return {
            available: true,
            authenticated: true,
            version: output,
          };
        }

        return {
          available: true,
          authenticated: false,
          error: "Codex CLI is installed but not logged in. Run: codex login",
        };
      } catch {
        return {
          available: true,
          authenticated: false,
          error: "Could not verify login status. Run: codex login",
        };
      }
    } catch (error) {
      return {
        available: false,
        authenticated: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
