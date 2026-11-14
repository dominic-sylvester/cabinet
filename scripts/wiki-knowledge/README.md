# Raw wiki tooling

Two backends live here. Only one is live.

| Directory | Status |
|---|---|
| `duckdb/` | **live** — filesystem-authoritative corpus + derived DuckDB index. Build with `build_duckdb.py`, query with `wikiq.py`. |
| `archive-postgres/` | **retired** — the original PostgreSQL importer (`cabinet_wiki_v1`, container `cabinet-wiki`). Kept as the rollback path and as documentation of how the corpus was first materialised and hash-verified. |

Agent access is `mcps/mcp-wiki` (read-only MCP: `wiki_search`, `wiki_read`, `wiki_list`, `wiki_stats`).

The corpus is at `~/Development/investment-brain-data/raw`; provenance at
`~/Development/cabinet/data/.cabinet-state/knowledge/raw-wiki-v1.json`; the index at
`~/Development/investment-brain-data/wiki-index/wiki.duckdb`.

To rebuild after corpus edits:

```bash
uv run --quiet --with duckdb python3 scripts/wiki-knowledge/duckdb/build_duckdb.py \
  --root ~/Development/investment-brain-data/raw \
  --manifest ~/Development/cabinet/data/.cabinet-state/knowledge/raw-wiki-v1.json \
  --out ~/Development/investment-brain-data/wiki-index/wiki.duckdb
```

The build refuses to publish unless all 7,450 source hashes still match the manifest, so a
stale or partly-edited corpus fails loudly instead of silently re-indexing.

## Reinstating PostgreSQL

`archive-postgres/README.md` has the full procedure. In short: create a `postgres:16`
container with `--network none`, no published ports and a dedicated volume, then run
`archive-postgres/cli.mjs import --root … --manifest …`. The importer re-reads the Markdown
tree, so nothing needs the old dump — which is why the 450 MB `raw-wiki.dump` was removed.
