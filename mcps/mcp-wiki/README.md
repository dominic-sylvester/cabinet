# cabinet-mcp-wiki

Cabinet-maintained, **read-only** MCP server over the raw-wiki DuckDB index
(`~/Development/investment-brain-data/wiki-index/wiki.duckdb`).

Raw Markdown stays on disk and is the byte authority. The index holds derived
metadata plus chunked search text only; `wiki_read` re-hashes the source and reports
`source_drift` rather than quoting bytes that no longer match the indexed revision.

## Tools

| Tool | Purpose |
|---|---|
| `wiki_search` | BM25 over 43,200 chunks / 7,450 documents; ranked docs with excerpt |
| `wiki_read` | one document by id or path; revision pinning, section extraction, pagination, drift refusal |
| `wiki_list` | path-ordered listing, optional category filter |
| `wiki_stats` | counts, per-category totals, manifest generation (checksum + built_at) |

DuckDB FTS has no phrase operators, so pass AND-joined terms (`margin AND safety`),
not quoted phrases. Ranking is BM25, not Postgres `ts_rank`.

## Configuration

| Env | Default |
|---|---|
| `WIKI_DUCKDB` | `~/Development/investment-brain-data/wiki-index/wiki.duckdb` |

## Build and verify

```bash
npm install
npm run typecheck
npm run smoke   # builds, then exercises all four tools over real stdio
```

Registering it (what Cabinet's Integrations Hub displays but does not manage):

```bash
codex mcp add wiki --env WIKI_DUCKDB=$HOME/Development/investment-brain-data/wiki-index/wiki.duckdb -- node $PWD/dist/index.js
claude mcp add --scope user wiki -e WIKI_DUCKDB=$HOME/Development/investment-brain-data/wiki-index/wiki.duckdb -- node $PWD/dist/index.js
```

Index maintenance lives in `scripts/wiki-knowledge/duckdb/`.
