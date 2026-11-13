import test from "node:test";
import assert from "node:assert/strict";
import { cursorCliProvider, parseCursorModels } from "./cursor-cli";

// Trimmed from real `cursor-agent --list-models` output (2026.11.11): a header
// line, a blank, then `id - Name` rows resolved per account.
const LISTING = `Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex-low-fast - Codex 5.3 Low Fast
composer-2.5 - Composer 2.5 (current)
claude-opus-5-thinking-high - Claude Opus 5 1M Thinking
claude-fable-5-thinking-xhigh - Claude Fable 5 1M Extra High Thinking (NO ZDR)
grok-4.7-medium-fast - Grok 4.7  Medium Fast`;

test("parseCursorModels reads the id - name rows and skips the header", () => {
  const models = parseCursorModels(LISTING);

  assert.deepEqual(
    models.map((model) => model.id),
    [
      "auto",
      "gpt-5.3-codex-low",
      "gpt-5.3-codex-low-fast",
      "composer-2.5",
      "claude-opus-5-thinking-high",
      "claude-fable-5-thinking-xhigh",
      "grok-4.7-medium-fast",
    ]
  );
  assert.equal(models[0].name, "Auto (default)");
  // Names keep their parentheticals and padding quirks; only the first
  // separator splits.
  assert.equal(models[5].name, "Claude Fable 5 1M Extra High Thinking (NO ZDR)");
  assert.equal(models[6].name, "Grok 4.7  Medium Fast");
  assert.equal(models[0].effortLevels?.length, 0);
});

test("parseCursorModels drops noise, duplicates, and non-id rows", () => {
  assert.deepEqual(parseCursorModels(""), []);
  assert.deepEqual(parseCursorModels(null), []);
  assert.deepEqual(parseCursorModels("Available models"), []);
  assert.deepEqual(parseCursorModels("error: not logged in, run cursor-agent login"), []);
  // A row whose left side is whitespace, or that repeats an id, is skipped.
  assert.deepEqual(
    parseCursorModels("Available models\n\n - Nameless\nauto - Auto\nauto - Auto again").map(
      (model) => model.id
    ),
    ["auto"]
  );
});

test("cursor provider exposes live discovery and keeps its static fallback", () => {
  assert.equal(typeof cursorCliProvider.listModels, "function");
  assert.ok((cursorCliProvider.models ?? []).some((model) => model.id === "auto"));
});
