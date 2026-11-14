import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Wiki } from "./wiki.js";

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(err: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

const READ_ONLY_NOTE =
  "Read-only over the raw-wiki DuckDB index. Raw Markdown is re-hashed on every read; " +
  "a drifted source is reported, never silently quoted.";

export function registerTools(server: McpServer, wiki: Wiki): void {
  server.registerTool(
    "wiki_search",
    {
      title: "Search the raw wiki corpus",
      description:
        `${READ_ONLY_NOTE} BM25 over 43.2k chunks (7,450 documents). ` +
        "DuckDB FTS has no phrase operators, so pass AND-joined terms " +
        "(e.g. 'margin AND safety'), not quoted phrases. Returns ranked documents with " +
        "a first-term-centred excerpt.",
      inputSchema: {
        query: z.string().min(1).describe("BM25 terms, AND-joined. No phrase syntax."),
        category: z
          .string()
          .optional()
          .describe(
            "Restrict to a corpus category: investor-letters, damodaran, textbooks, " +
              "howard-marks, courses, berkshire-hathaway, buffett-partnership, sec.",
          ),
        limit: z.number().int().min(1).max(50).default(10),
        offset: z.number().int().min(0).max(10000).default(0),
      },
    },
    async ({ query, category, limit, offset }) => {
      try {
        return json(await wiki.search(query, category, limit, offset));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "wiki_read",
    {
      title: "Read one raw wiki document",
      description:
        `${READ_ONLY_NOTE} Accepts a document id or a source-relative path. ` +
        "Pin `revision` to the SHA-256 you were given so a corrected source cannot " +
        "silently answer for the old one. Paginate with offset/limit; `full` returns " +
        "the whole document and ignores pagination.",
      inputSchema: {
        identifier: z.string().min(1).describe("Document UUID or source-relative path."),
        revision: z
          .string()
          .optional()
          .describe("Expected SHA-256 of the source; mismatches return revision_not_found."),
        section: z
          .string()
          .optional()
          .describe("Exact ATX heading text; returns that heading through the next same-or-higher heading."),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(1000000).default(12000),
        full: z.boolean().default(false),
        allow_drift: z
          .boolean()
          .default(false)
          .describe("Return text even when the on-disk file no longer matches the indexed hash."),
      },
    },
    async ({ identifier, revision, section, offset, limit, full, allow_drift }) => {
      try {
        const res = await wiki.read({
          identifier,
          revision,
          section,
          offset,
          limit,
          full,
          allowDrift: allow_drift,
        });
        return json(res);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "wiki_list",
    {
      title: "List raw wiki documents",
      description: `${READ_ONLY_NOTE} Path-ordered listing with byte sizes, optionally by category.`,
      inputSchema: {
        category: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).max(10000).default(0),
      },
    },
    async ({ category, limit, offset }) => {
      try {
        return json(await wiki.list(category, limit, offset));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "wiki_stats",
    {
      title: "Raw wiki index stats",
      description:
        `${READ_ONLY_NOTE} Document/chunk counts, per-category totals, and the ` +
        "manifest generation the index was built from (checksum + built_at).",
      inputSchema: {},
    },
    async () => {
      try {
        return json(await wiki.stats());
      } catch (err) {
        return fail(err);
      }
    },
  );
}

