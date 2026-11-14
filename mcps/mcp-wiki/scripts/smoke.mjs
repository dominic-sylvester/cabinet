import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env },
});

const client = new Client({ name: "mcp-wiki-smoke", version: "0.0.0" });
await client.connect(transport);

const payload = (res) => {
  assert.equal(res.isError, undefined, `tool errored: ${res.content?.[0]?.text}`);
  return JSON.parse(res.content[0].text);
};

const { tools } = await client.listTools();
assert.deepEqual(
  tools.map((t) => t.name).sort(),
  ["wiki_list", "wiki_read", "wiki_search", "wiki_stats"],
  `unexpected tool set: ${tools.map((t) => t.name).join(", ")}`,
);
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

const stats = payload(await client.callTool({ name: "wiki_stats", arguments: {} }));
assert.equal(stats.documents, 7450, "document count");
assert.equal(stats.chunks, 43200, "chunk count");
assert.equal(stats.meta.manifest_checksum.slice(0, 8), "2ff623af", "manifest checksum");
console.log(
  `stats: ${stats.documents} docs / ${stats.chunks} chunks / ${stats.categories.length} categories`,
);

const search = payload(
  await client.callTool({
    name: "wiki_search",
    arguments: { query: "margin AND safety", limit: 3 },
  }),
);
assert.equal(search.results.length, 3, "search result count");
assert.ok(search.total > 100, `search total too small: ${search.total}`);
assert.ok(search.results[0].excerpt.length > 0, "excerpt empty");
console.log(`search: ${search.total} matching docs, top = ${search.results[0].path}`);

const list = payload(
  await client.callTool({
    name: "wiki_list",
    arguments: { category: "howard-marks", limit: 2 },
  }),
);
assert.equal(list.total, 168, "howard-marks total");
assert.equal(list.results.length, 2, "list page size");
console.log(`list: howard-marks total=${list.total}`);

const doc = payload(
  await client.callTool({
    name: "wiki_read",
    arguments: { identifier: "howard-marks/MANIFEST.md", limit: 200 },
  }),
);
assert.equal(doc.drift, false, "unexpected drift");
assert.equal(doc.text_method, "lossless_utf8", "text method");
assert.ok(doc.text.startsWith("# Howard Marks"), "unexpected document head");
console.log(`read: ${doc.path} rev=${doc.revision.slice(0, 12)} chars=${doc.total_chars}`);

const pinned = payload(
  await client.callTool({
    name: "wiki_read",
    arguments: { identifier: doc.id, revision: doc.revision, limit: 50 },
  }),
);
assert.equal(pinned.path, doc.path, "revision-pinned read returned wrong doc");
console.log("read: revision pin honoured");

const wrongRev = payload(
  await client.callTool({
    name: "wiki_read",
    arguments: { identifier: "howard-marks/MANIFEST.md", revision: "deadbeef" },
  }),
);
assert.equal(wrongRev.error, "revision_not_found", "expected revision_not_found");
console.log("read: stale revision rejected");

const missing = payload(
  await client.callTool({
    name: "wiki_read",
    arguments: { identifier: "no/such/doc.md" },
  }),
);
assert.equal(missing.error, "not_found", "expected not_found");
console.log("read: unknown identifier rejected");

const nul = payload(
  await client.callTool({
    name: "wiki_read",
    arguments: { identifier: "damodaran/markdown/PvtFirm.md", limit: 80 },
  }),
);
assert.equal(nul.derived, true, "NUL document should be flagged derived");
assert.equal(nul.text_method, "nul_removed", "NUL text method");
console.log(`read: NUL document flagged derived (${nul.total_chars} chars)`);

await client.close();
console.log("PASS — all 4 tools exercised over stdio.");
