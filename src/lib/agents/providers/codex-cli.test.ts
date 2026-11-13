import test from "node:test";
import assert from "node:assert/strict";
import { codexCliProvider, parseCodexModels } from "./codex-cli";

// Shape mirrors `codex debug models` (Codex 0.167.2): a single JSON document
// with a `models` array, each entry carrying slug/display_name/description/
// visibility/supported_reasoning_levels. `hide` entries are internal aliases.
const CATALOG = JSON.stringify({
  models: [
    {
      slug: "gpt-6.1-sol",
      display_name: "GPT-6.1-Sol",
      description: "Latest workhorse model for coding and everyday work.",
      visibility: "list",
      priority: 1,
      supported_reasoning_levels: [
        { effort: "low", description: "Fast responses with lighter reasoning" },
        {
          effort: "max",
          description: "Maximum reasoning depth for the hardest problems",
        },
        {
          effort: "ultra",
          description: "Maximum reasoning with automatic task delegation",
        },
      ],
    },
    {
      slug: "gpt-reserve",
      display_name: "GPT-Reserve",
      description: "Internal.",
      visibility: "hide",
      priority: 5,
      supported_reasoning_levels: [{ effort: "low" }],
    },
    {
      slug: "gpt-5.6-luna",
      display_name: "GPT-5.6-Luna",
      description: "Older fast and efficient model.",
      visibility: "list",
      priority: 9,
      supported_reasoning_levels: [{ effort: "low" }, { effort: "xhigh" }],
    },
  ],
});

test("parseCodexModels maps the live catalog and drops hidden entries", () => {
  const models = parseCodexModels(CATALOG);

  assert.deepEqual(
    models.map((model) => model.id),
    ["gpt-6.1-sol", "gpt-5.6-luna"],
  );
  assert.equal(models[0].name, "GPT-6.1-Sol");
  assert.equal(
    models[0].description,
    "Latest workhorse model for coding and everyday work.",
  );
  assert.deepEqual(
    models[0].effortLevels?.map((level) => level.id),
    ["low", "max", "ultra"],
  );
  // Names are humanised, and catalog descriptions are preserved.
  assert.deepEqual(models[0].effortLevels?.[1], {
    id: "max",
    name: "Max",
    description: "Maximum reasoning depth for the hardest problems",
  });
  assert.equal(models[1].effortLevels?.[1].name, "Extra High");
});

test("parseCodexModels tolerates CLI chrome before the JSON payload", () => {
  const models = parseCodexModels(`Reading models cache...\n${CATALOG}`);
  assert.equal(models.length, 2);
});

test("parseCodexModels degrades to an empty list on unusable output", () => {
  assert.deepEqual(parseCodexModels(""), []);
  assert.deepEqual(parseCodexModels(null), []);
  assert.deepEqual(parseCodexModels("not json at all"), []);
  assert.deepEqual(parseCodexModels('{"models":"nope"}'), []);
  // Entries without a usable slug are skipped rather than emitted blank.
  assert.deepEqual(
    parseCodexModels('{"models":[{"display_name":"x"},{"slug":"  "}]}'),
    [],
  );
});

test("codex provider exposes live discovery and keeps a non-empty fallback", () => {
  assert.equal(typeof codexCliProvider.listModels, "function");
  const fallback = codexCliProvider.models ?? [];
  assert.ok(fallback.length > 0);
  // The current generation leads the offline fallback so a failed probe never
  // leaves the picker pointing at a retired flagship.
  assert.equal(fallback[0].id, "gpt-6.1-sol");
  assert.ok(fallback.some((model) => model.id === "gpt-5.5"));
  // Legacy entries keep their auth badges; live entries carry their own rungs.
  assert.equal(
    fallback.find((model) => model.id === "gpt-5.5")?.requires,
    "chatgpt_plan",
  );
  assert.ok(
    (fallback[0].effortLevels ?? []).some((level) => level.id === "ultra"),
  );
});
