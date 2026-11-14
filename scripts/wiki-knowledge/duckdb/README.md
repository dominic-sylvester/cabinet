# Raw wiki: DuckDB index (no Postgres)

The Markdown tree is the authority for bytes. This directory holds the **derived**
index and the operator CLI that query it. No container, no database server.

| Path | Role |
|---|---|
| `~/Development/investment-brain-data/raw` | byte authority — 7,450 `.md`, 437,034,346 bytes |
| `~/Development/cabinet/data/.cabinet-state/knowledge/raw-wiki-v1.json` | provenance: per-file `id` / `path` / `category` / `sha256` / `bytes` / `reason`, plus a generation checksum |
| `~/Development/investment-brain-data/wiki-index/wiki.duckdb` | index: 7,450 documents, 43,200 chunks, FTS — **no raw bytes stored** |
| `build_duckdb.py` | rebuilds + verifies the index (33s for the full corpus) |
| `wikiq.py` | `stats` / `list` / `search` / `read`, JSON on stdout |

Run both with the same runtime the fleet already uses for `secq`:

```bash
uv run --quiet --with duckdb python3 build_duckdb.py \
  --root ~/Development/investment-brain-data/raw \
  --manifest ~/Development/cabinet/data/.cabinet-state/knowledge/raw-wiki-v1.json \
  --out ~/Development/investment-brain-data/wiki-index/wiki.duckdb

uv run --quiet --with duckdb python3 wikiq.py search 'margin AND safety' --limit 5
uv run --quiet --with duckdb python3 wikiq.py read 'howard-marks/MANIFEST.md' --limit 4000
uv run --quiet --with duckdb python3 wikiq.py read <doc-id> --revision <sha256> --full
```

## Guarantees

- The build recomputes **every** file's SHA-256 and refuses to publish if any file
  disagrees with the manifest. Publication is a temp-file rename, so a failed build
  leaves the previous index intact.
- `read` re-hashes the file on disk. A drifted source returns `source_drift` with the
  indexed and actual hashes instead of quoting the wrong bytes; `--allow-drift` overrides.
- `--revision <sha256>` pins a read to the revision a citation was taken from and
  returns `revision_not_found` when it no longer holds.
- 46 documents contain NUL bytes. Their FTS text is stored with U+0000 stripped
  (`reason="nul"`, `text_method="nul_removed"`); the on-disk bytes are never modified.

## Known differences from the retired Postgres store

- DuckDB FTS has **no phrase operators**: `"margin of safety"` matches 2,561 documents
  where Postgres websearch phrase matched 498 (top-5 overlap 4/5, different order).
  Search with `AND`-joined terms, or filter hits for token adjacency in the caller.
- No `ts_headline` equivalent — excerpts are a first-term-centred 1600-character window.
- No stored revision *history*: the index pins the current hash. A corrected source is
  reported as drift, not kept as a second revision. `raw-wiki.dump` holds the imported
  Postgres generations for as long as it is retained.

Reads are concurrency-safe (verified with 8 parallel read-only connections, ~0.1s each).
DuckDB is single-writer, so an import is a stop-the-world rebuild — acceptable for a
static corpus.
