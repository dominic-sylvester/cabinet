# Raw wiki knowledge: local PostgreSQL operator CLI

Node standard-library tool for retaining **all original Markdown bytes** in the dedicated
`cabinet-wiki` PostgreSQL container / `cabinet_wiki` database. Curated Cabinet pages remain
files. This is **not** a production MCP endpoint, application integration, room authorization
layer, or remotely accessible service. PostgreSQL is accessed only through:

```text
docker exec -i CONTAINER psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d cabinet_wiki
```

Requires Node 22+ and Docker CLI, PostgreSQL 16+ with bundled `pgcrypto`, local postgres
trust authentication. No npm dependencies. The operator provisions the dedicated container,
persistent volume, `--network none`, no published ports, no corpus/source mounts, and a
768 MiB memory limit. This tool neither provisions Docker nor connects to the sample/Twenty
DBs. Never point it at a shared application's database. Schema is **`cabinet_wiki_v1`**;
manifest format version is **1**. Import initializes/upgrades schema transactionally and idempotently.
The additive NUL-safe upgrade adds `search_text`, replaces the old searchability CHECK,
and backfills derived text/chunks for retained legacy NUL revisions; original bytes,
hashes, IDs and generation membership are unchanged. Earlier manifests that marked NUL
revisions nonsearchable no longer match upgraded searchability metadata: retain them
for audit, then reimport to produce a current verifiable manifest. Ordinary old manifests
remain verifiable. No database reset is required.

## Entire corpus import and verification

From the Cabinet repository root:

```bash
node scripts/wiki-knowledge/cli.mjs import \
  --root /Users/domsylvester/Development/investment-brain-data/raw \
  --manifest /Users/domsylvester/Development/cabinet/data/.cabinet-state/knowledge/raw-wiki-v1.json

node scripts/wiki-knowledge/cli.mjs verify \
  --manifest /Users/domsylvester/Development/cabinet/data/.cabinet-state/knowledge/raw-wiki-v1.json

node scripts/wiki-knowledge/cli.mjs stats
```

Do not run concurrent imports to the same manifest path. Use a durable path **outside the
source root**, not scratch. Final manifests are atomic-renamed and fsynced, including their
directory. `<manifest>.journal.jsonl` is append-only and fsynced after every committed batch;
it includes run ID, per-file metadata, completed batches, and file-specific errors. Existing
completed manifests are not overwritten on failed imports. Keep manifests and journal with
DB backups. No source file is written, moved, or deleted.

Each batch defaults to 20 documents, also flushing at 16 MiB source bytes. One `psql`
connection per batch streams base64 JSON rows via `COPY` into a temporary staging table.
No subprocess per document and no shell or path-interpolated SQL. Each batch commits a
**loading generation**, not current documents. On any file, SQL, encoding, or verification
failure, import exits nonzero; it never silently skips files. Every valid-UTF8 document,
including NUL-containing sources, has searchable text. NUL sources retain exact bytes,
`raw_markdown=NULL`, `reason="nul"`, and derived `search_text` with **all U+0000 removed**.
Invalid UTF8 remains byte-only/nonsearchable (`reason="invalid_utf8"`), without replacement
decoding or fabricated text. Hidden directories are included. Symlinks (including
directory symlinks) are rejected, and only case-sensitive `.md` regular files are imported.

After all batches, source size/mtime inventories are checked again and **every stored raw
byte hash is verified** before atomically publishing the generation pointer. The directory
is not a filesystem snapshot: quiesce source writers during import. Size/mtime checks detect
ordinary concurrent edits but cannot prove a cross-file point-in-time snapshot or detect
an adversary restoring timestamps. A publication readback is required before success output.

Retry the same import command after failure. Committed batches and journal survive; retries
reread source files and reuse stable document/revision keys (no duplicate revisions). They
create a new generation; this is **logical document/revision idempotency**, not byte-identical
run manifests or automatic cursor-resume. Failed/unpublished generations and historical
snapshots remain in the DB; cleanup/retention is deliberately not implemented. If a crash
occurs after final manifest write but before publication, the manifest can verify its retained
unpublished generation; rerun import to publish a fresh complete snapshot. A journal write
failure after publication can produce a nonzero exit even though publication succeeded;
inspect `stats.active_import` and `verify` before retrying.

## Commands / actual options

```bash
node scripts/wiki-knowledge/cli.mjs --help
node scripts/wiki-knowledge/cli.mjs list --limit 50 --offset 0
node scripts/wiki-knowledge/cli.mjs list --category letters --limit 20
node scripts/wiki-knowledge/cli.mjs search '"margin of safety"' --limit 10 --offset 0
node scripts/wiki-knowledge/cli.mjs search compounding --category letters
node scripts/wiki-knowledge/cli.mjs read 'letters/example.md' --offset 0 --limit 12000
node scripts/wiki-knowledge/cli.mjs read DOCUMENT_UUID --revision LOWERCASE_SHA256 --full
node scripts/wiki-knowledge/cli.mjs read 'letters/example.md' --section 'Investment philosophy'
```

All commands accept `--container NAME` (default `cabinet-wiki`). Import accepts
`--root`, `--manifest`, `--batch-size` (1–1000). Verify requires `--manifest`.
List/search accept `--category`, `--limit` (0–1000), `--offset` (0–10000000).
List defaults to 50 results, search to 20. Read accepts ID or source-relative path,
`--revision SHA256`, `--offset`, `--limit` (default 12000, maximum 1000000), `--section`,
`--full`. `--full` explicitly ignores pagination and returns the entire text. Without it,
invalid UTF8 reads return metadata with null text; `--full` also returns `raw_base64`
containing the exact original bytes. NUL reads return derived display text from
`search_text`, labeled `derived:true`, `reason:"nul"`, `text_method:"nul_removed"`;
`--full` returns both the display text and exact `raw_base64`. This display is **not**
the original Markdown. NUL-free UTF8 reads use `derived:false`,
`text_method:"lossless_utf8"` and preserve BOM, CRLF, and Unicode. Invalid UTF8 uses
`derived:false`, `text_method:"unavailable"` (there is no decoded display text).
Read pagination counts Unicode characters, not bytes or UTF16 code units.

Section selection matches exact ATX heading text (BOM allowed on first heading), includes
its heading, and ends at the next same/higher-level heading. It is a simple heading selector,
not a full Markdown parser: Setext headings and fenced-code heading semantics are unsupported.
Section extraction loads the selected document text into the operator process before bounding
output. `--full --section` returns the entire selected section.

Stdout is one JSON result; progress and errors go to stderr. List/search include `total`
**eligible document matches**, `results`, `offset`, `limit`, and `truncated` (more results
remain beyond this page). Search uses PostgreSQL `simple` web-search syntax, GIN-indexed
**at most 12288-byte**, paragraph-preferred chunks of `search_text`. It ranks each document by its
best matching chunk and returns its ordinal plus a query-centered excerpt capped at 1600
characters. Headlining is computed only for returned documents. `simple` is not stemming,
semantic search, fuzzy matching, or literal substring search. All terms/phrases must match
within a single chunk, so cross-chunk phrases/AND matches can be missed. PostgreSQL's own
very-long-token rules still apply (tokens above its lexeme limit are not searchable).
Original bytes remain intact regardless of tokenization. NUL removal can join adjacent
characters/tokens; it is a documented search/display transformation, not source repair.
A NUL-only document is represented as searchable empty text, with no token hits.
Search excerpts use derived text too; list/read expose the source representation reason.
Search does not search
paths or historical/unpublished revisions. Read with an explicit hash can access retained
historical revisions. `stats` reports current documents/bytes/searchable/category totals,
active import, and **all retained** revision/chunk counts.

## Integrity model

- Document UUIDs derive deterministically from a namespace and source-relative path.
  Moving the root does not change identity; renaming a file does. One corpus per DB/schema.
- Revision primary key is `(document_id, sha256)`. Existing revisions are never overwritten
  by this importer; changed content creates a revision. SHA256 is also the revision citation.
- `raw_bytes BYTEA` is authoritative. `raw_markdown TEXT` is present only when UTF8 decoding
  is lossless and NUL-free, and a DB constraint requires its UTF8 bytes to equal `raw_bytes`.
- `search_text TEXT` is distinct from lossless `raw_markdown`: identical for NUL-free
  UTF8, NUL-removed for valid UTF8 with NUL, null for invalid UTF8. Representation CHECKs
  permit searchable NUL sources with an explicit reason, and reject inconsistent rows.
  Legacy NUL chunk backfill uses at most 3072 Unicode characters per chunk (12288 bytes);
  a later import atomically rebuilds derived chunks using the normal paragraph algorithm.
  Original revision bytes/text are never overwritten.
- DB constraints recompute SHA256 on insert/update; verification independently recomputes
  **all** manifest hashes from stored BYTEA, checks paths/categories/lengths/searchability,
  generation membership, stored manifest checksum, and ordered chunk reconstruction equal
  to `search_text`. Raw-Markdown byte equality is checked only where lossless text exists;
  derived NUL text is independently checked against NUL-stripped original bytes.
- The external manifest includes every path, UUID, hash, byte length, category,
  searchable flag/reason, aggregate counts, and canonical metadata SHA256. `verify` does
  **not** need the original root and can verify retained older-generation manifests.
- Publishing switches one active generation, which supplies the current revision pointer
  for every visible document. Missing files disappear from current results only after an
  entirely successful import; historical revisions remain available.
- This trusted local postgres-role tool is not a security boundary. Administrators can
  bypass/change constraints. Manifests are checksums, not signatures. No DB backup, restore,
  external audit, authorization, or remote API is supplied.

## Tests and RED/GREEN evidence

No Docker required:

```bash
node --test scripts/wiki-knowledge/*.test.mjs
```

Optional integration: use a **separate disposable test-only container** with `cabinet_wiki`
database / postgres role. The environment variable must explicitly name a container
containing `test` and cannot equal `cabinet-wiki`. Tests mutate only that supplied test
schema, including injecting/recovering failures. They never default to the live target.
Do not run two integration suites concurrently against the same test container.

```bash
WIKI_KNOWLEDGE_TEST_CONTAINER=cabinet-wiki-integration-test \
  node --test scripts/wiki-knowledge/*.test.mjs
```

Test fixtures/manifests are retained under `~/.hermes/cache/scratch/wiki-*`, not the corpus.
Real PostgreSQL tests exercise >1 MiB content, byte-preserving BOM/CRLF/emoji, invalid UTF8,
NUL-searchable hidden files, derived reads plus exact raw bytes, NUL chunk corruption,
historical NUL revisions, and rollback-only legacy representation migration,
quote-containing paths, SQL-like queries, bounded query-centered excerpts, section/page/full
reads, unchanged reimport deduplication, changed revisions/old reads, all-content verification,
manifest corruption, failed-batch nonpublication, durable error journals, missing chunks,
and the DB raw-byte checksum guard.

Observed RED: missing core implementation (1 failing test), then missing CLI (1 failing
integration test). GREEN followed implementation. Additional regressions were reproduced
RED for a tail-of-chunk match absent from excerpts, and BOM-prefixed section selection;
both passed after their fixes. Integration suites use actual PostgreSQL, never synthetic
DB responses. NUL regression RED: unit searchability was false and PostgreSQL read text
was null; GREEN after explicit derived search-text implementation. Full-corpus production
import is intentionally left to the operator.

[2026-11-13] Added explicit NUL-derived `search_text`, lossless-byte-preserving reads,
transactional v1 migration and NUL/historical/integrity regressions. PostgreSQL suite:
6 tests passed, 0 failed, 0 skipped. A read-only source walk (no database import)
verified all 7,450 `.md` files / 437,034,346 bytes, including hidden directories:
7,450 searchable representations and ordered chunk reconstructions; 46 NUL documents
with 520 NUL characters removed only from derived text; 7,404 lossless Markdown texts;
0 invalid-UTF8 documents; all 7,450 exact raw-byte/base64/hash roundtrips passed.
This is source-side readiness verification, not proof of a production database import.
