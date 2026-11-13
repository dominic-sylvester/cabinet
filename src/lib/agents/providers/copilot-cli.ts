import type { AgentProvider, ProviderStatus } from "../provider-interface";
import {
  checkCliProviderAvailable,
  execCli,
  resolveCliCommand,
} from "../provider-cli";

// Copilot CLI's `--model` accepts only what the user's plan exposes, and the
// CLI has no listing command (`copilot models` is not a subcommand; an invalid
// `--model` errors without printing the valid set). So this stays static — but
// it is a *validated* set, not a guess: every id below was run through
// `copilot -p "reply OK" --model <id>` on 2026-11-13 (CLI 1.0.87) and answered,
// while the rest of the docs catalog answered "Model … is not available"
// (no Opus/Fable/GPT-6-flagship entitlement on this plan). Names come from
// https://docs.github.com/copilot/reference/ai-models/supported-models.
// Entitlements are per-account, so re-validate rather than trusting the docs
// list wholesale — and don't badge these with `requires`, which models the
// ChatGPT/API-key split Codex has and Copilot does not.
const COPILOT_MODELS = [
  {
    id: "auto",
    name: "Auto (recommended)",
    description: "Copilot picks the best model for each turn based on your plan",
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    description: "Codex-tuned OpenAI model (Copilot's long-term support default)",
  },
  {
    id: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    description: "OpenAI GPT-6.1 flagship, Terra variant",
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    description: "Fast, lower-cost GPT-6 variant",
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Previous-generation GPT-5.6 flagship",
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fast, lower-cost GPT-5.6 variant",
  },
  {
    id: "claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    description: "Anthropic Sonnet, newest version",
  },
  {
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    description: "Anthropic Sonnet 5",
  },
  {
    id: "claude-haiku-5.5",
    name: "Claude Haiku 5.5",
    description: "Fast Anthropic Haiku, newest version",
  },
  {
    id: "claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    description: "Fast Anthropic Haiku 4.5",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Fast Google model for agentic and enterprise workflows",
  },
  {
    id: "grok-4.7",
    name: "Grok 4.7",
    description: "xAI's newest Grok",
  },
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    description: "Previous xAI Grok",
  },
  {
    id: "kimi-k3",
    name: "Kimi K3",
    description: "Moonshot AI's Kimi K3",
  },
  {
    id: "mai-code-1.1-flash",
    name: "MAI-Code-1.1-Flash",
    description: "Microsoft's code-focused Flash model",
  },
] as const;

export const copilotCliProvider: AgentProvider = {
  id: "copilot-cli",
  name: "Copilot CLI",
  type: "cli",
  icon: "copilot",
  iconAsset: "/providers/copilot.svg",
  installMessage:
    "GitHub Copilot CLI not found. Install with: npm install -g @github/copilot",
  installSteps: [
    {
      title: "Get a Copilot subscription",
      detail:
        "Any GitHub Copilot plan works (Individual, Business, or Enterprise).",
      link: {
        label: "GitHub Copilot plans",
        url: "https://github.com/features/copilot/plans",
      },
    },
    {
      title: "Install Copilot CLI",
      detail: "Run the following in your terminal:",
      command: "npm install -g @github/copilot",
    },
    {
      title: "Sign in to GitHub",
      detail:
        "Authenticate Copilot CLI with your GitHub account. It reuses `gh` auth when available:",
      command: "copilot auth login",
    },
    {
      title: "Verify setup",
      detail: "Confirm headless mode works:",
      command: "copilot -p 'Reply with exactly OK' --allow-all-tools",
    },
  ],
  detachedPromptLaunchMode: "one-shot",
  models: COPILOT_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    effortLevels: [],
  })),
  effortLevels: [],
  command: "copilot",
  commandCandidates: [
    `${process.env.HOME || ""}/.local/bin/copilot`,
    "/usr/local/bin/copilot",
    "/opt/homebrew/bin/copilot",
    "copilot",
  ],

  buildArgs(prompt: string, _workdir: string): string[] {
    return ["-p", prompt, "--allow-all-tools"];
  },

  buildOneShotInvocation(prompt: string, workdir: string, opts) {
    const baseArgs = this.buildArgs ? this.buildArgs(prompt, workdir) : [];
    const args = [...baseArgs];
    if (opts?.model) {
      args.push("--model", opts.model);
    }
    return {
      command: this.command || "copilot",
      args,
    };
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

      try {
        const cmd = resolveCliCommand(this);
        const version = await execCli(cmd, ["--version"], { timeout: 5000 });

        return {
          available: true,
          authenticated: true,
          version: version ? `Copilot CLI ${version}` : "Copilot CLI installed",
        };
      } catch {
        return {
          available: true,
          authenticated: false,
          error:
            "Copilot CLI is installed but not authenticated. Run: copilot auth login",
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
