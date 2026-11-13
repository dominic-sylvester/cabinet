import test from "node:test";
import assert from "node:assert/strict";
import { grokCliProvider, parseGrokModels } from "./grok-cli";

// Real `grok models` output (grok 1.0.77): an auth banner, the default-model
// line, then a bulleted catalog where `*` marks the CLI default.
const LISTING = `You are logged in with grok.com.

Default model: grok-4.7

Available models:
  * grok-4.7 (default)
  - grok-4.7-build-fast
  - grok-4.6
  - grok-4.5
  - grok-build`;

test("parseGrokModels reads only the catalog section", () => {
  const models = parseGrokModels(LISTING);

  assert.deepEqual(
    models.map((model) => model.id),
    ["grok-4.7", "grok-4.7-build-fast", "grok-4.6", "grok-4.5", "grok-build"]
  );
  // No display names in the output; id doubles as name.
  assert.equal(models[0].name, "grok-4.7");
  assert.equal(models[0].description, "CLI default");
  assert.equal(models[1].description, undefined);
  // The banner and `Default model:` line must not leak in as models.
  assert.ok(!models.some((model) => model.id.includes("Default")));
});

test("parseGrokModels handles the signed-out banner and unusable output", () => {
  const signedOut = LISTING.replace("You are logged in with grok.com.", "You are not authenticated.");
  assert.equal(parseGrokModels(signedOut).length, 5);

  assert.deepEqual(parseGrokModels(""), []);
  assert.deepEqual(parseGrokModels(null), []);
  assert.deepEqual(parseGrokModels("You are not authenticated."), []);
  // Duplicate ids collapse to one entry.
  assert.deepEqual(
    parseGrokModels("Available models:\n  - grok-4.7\n  * grok-4.7 (default)").map((m) => m.id),
    ["grok-4.7"]
  );
});

test("grok provider exposes live discovery and keeps its static fallback", () => {
  assert.equal(typeof grokCliProvider.listModels, "function");
  assert.ok((grokCliProvider.models ?? []).length > 0);
});
