# PostgreSQL Raw Wiki and Cabinet Curation Implementation Plan

## Authoritative scope correction (2026-11-13)

**This section supersedes conflicting architecture, schema, tasks and acceptance criteria below. The earlier path-catalog-only design is retained as background, not an executable specification. Reconcile the detailed tasks with this section before implementation.**

The user confirmed: **keep curated Cabinet pages as `.md` files; raw wiki content lives in PostgreSQL.** PostgreSQL must store the actual original wiki Markdown, not merely file paths, hashes or lossy plaintext. Agents read/search that database corpus and author curated Markdown pages through Cabinet's existing filesystem/editor workflows.

### Ownership

- Raw wiki: PostgreSQL becomes authoritative after verified import and explicit cutover. Original files are import inputs, not a required runtime mirror.
- Curated pages: Cabinet `.md` files remain authoritative, retaining the current editor, assets, tree and Git history.
- Other raw evidence (PDFs, spreadsheets, attachments): may remain in approved external storage with controlled reads and explicit asset/link resolution.
- Existing SQLite app state and FlexSearch page search stay unchanged.
- Raw wiki revisions are read-only to curation agents in v1. Source corrections create explicit new revisions; agents do not overwrite evidence.

### Mandatory schema/task corrections

1. **Store lossless source.** Each immutable wiki revision stores complete original Markdown, including frontmatter, whitespace, wiki links and relative references. Parsed metadata/search text are derivatives. Preserve original bytes if text decoding cannot round-trip; reject/report unsupported encoding rather than silently replace it. Hash original bytes. Do not import through `readPage`.
2. **Stable identity and scope.** Documents have source-scoped stable IDs and original-path aliases, distinct from equal slugs/content hashes. Bind source access to authorized room/workspace context, including intentional shared sources. A shared daemon bearer token or model-supplied room field alone is not scoped authorization. Validate evidence/current-revision ownership using constraints or transactions.
3. **Import, not filesystem synchronization.** Add manifests and staged import publication with per-file hashes/counts/errors. Re-import unchanged data is idempotent; changed input appends a revision. Interrupted scans/unavailable roots must not erase data, mark the entire corpus missing or publish partial generations. No watcher-driven two-way sync.
4. **Read from Postgres.** `knowledge_read_revision` returns source Markdown from the database, optionally in bounded sections. `knowledge_search` searches derived database body/title text using PostgreSQL full-text search, not only path/title ILIKE. Preserve source namespaces for link resolution and surface ambiguous/unresolved links. File reads are optional evidence tools, not the primary wiki retrieval path.
5. **Curation provenance.** Curated `.md` pages cite raw document/revision IDs and quote/span evidence. Add idempotent curation-link registration and reconciliation because a filesystem save and database update cannot be one transaction. New raw revisions flag dependent curated pages for review without rewriting them. Defer domain fact extraction schemas until one actual analytical question defines their fields.
6. **Agent surface.** Prioritize `knowledge_search`, `knowledge_read_revision`, `knowledge_resolve_link`, `knowledge_list_sources` and `knowledge_register_curation`. Separate operator import/source registration from curation-agent reads. Bridge through trusted per-run scope, not a globally fixed room. Never expose the database credential, arbitrary SQL or broad environment secrets to the MCP process. An allowlisted tool does not sandbox a CLI that independently has filesystem privileges.
7. **Operational correctness.** Use one authoritative migration definition (no duplicated schema.sql), locked/checksummed migrations and a bounded daemon-owned pool. Database is optional at boot. Configure securely only after choosing the deployment target. No invented credentials, auto-install or provider-config edits just for implementation/testing. All Postgres tests use explicitly isolated disposable targets; never run migrations against an arbitrary supplied production URL.
8. **Raw attachments.** Inventory relative links/assets during import. Keeping Markdown in Postgres does not move images/PDFs; retain a declared resolver/storage base or import assets separately. Do not promise complete portability until assets are covered.

### Revised implementation sequence

1. Freeze the lossless wiki/source/revision and room-access contracts; fixture tests for frontmatter, Unicode/CRLF, duplicate slugs, links and byte-exact round-trip.
2. Optional Postgres pool, safe migrations and isolated integration test harness; existing app remains usable without database configuration.
3. Lossless import, manifests, revision repository and staged publication; verify idempotency, failure recovery and removal semantics.
4. Database full-text search, paginated revision reads and namespace-aware links with authorization before counts/snippets.
5. Daemon service and app proxy; operator-only import controls distinct from scoped agent reads.
6. First-party MCP with trusted per-run scope; prove a real provider CLI reads database wiki and writes a curated Cabinet file with source citations.
7. Curation-link reconciliation and stale-review indicators; no automatic curated-page rewrites.
8. Documentation/persona corrections, backup restoration, export/reimport and packaged Electron verification. Do not commit, push or delete source files unless separately authorized.

### Required acceptance criteria

- Every imported wiki entry is accounted for; original source bytes/hashes round-trip, with explicit errors for unsupported input.
- **Database wiki search/read works when the original fixture import directory is unavailable.** This is the defining test of actual database storage.
- An agent reads a PostgreSQL source revision and creates/updates a real curated `.md` page in Cabinet, with verifiable citations.
- Identical re-import creates no duplicate revisions; a changed source preserves old cited revisions and marks dependent curation stale.
- Disabled/unauthorized sources leak no content, snippets or counts; traversal and malformed requests fail closed.
- Interrupted import never exposes partial corpus state or treats unreachable input as deletion.
- Postgres outage does not prevent curated Markdown editing.
- Restore into a disposable database preserves raw content, stable identities, citations and curation links; export/reimport and attachments are verified.
- Run real Postgres integration tests plus existing project gates with `NODE_ENV` unset. `npm test` currently collects `src` and `test`, not standalone MCP or server tests: wire explicit commands for those rather than assume coverage.
- Original raw wiki files are never automatically removed. Cleanup requires explicit approval after verified recovery/export. No permanent writable mirror with competing authority.

### Remaining deployment choices

Select first corpus and source access grants, and choose where Postgres runs before provisioning/import. These are not credentials or locations to guess.

---

## Earlier draft (superseded where inconsistent)

# PostgreSQL Knowledge Catalog Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add an optional PostgreSQL knowledge catalog so agents can query registered sources, open approved raw files, and write evidence-backed findings, without replacing Cabinet’s Markdown page editor or the existing SQLite app database.

**Architecture:** Keep curated Markdown files as the human/agent editing surface (`readPage` / `writePage` / tree / Git restore stay filesystem-native). Add a separate Postgres database as the source catalog, document index, revision hashes, and typed records. The daemon owns the Postgres pool and ingest, the Next.js app proxies operator APIs, and agents reach the catalog through a first-party stdio MCP server. File bytes stay on disk; Postgres stores identity, metadata, hashes, extracted plaintext when cheap, and citations. Unset `CABINET_KNOWLEDGE_DATABASE_URL` means Cabinet still boots and knowledge APIs return a setup error.

**Tech Stack:** PostgreSQL 16+, `pg`, existing daemon HTTP + bearer token, first-party MCP under `mcps/` (`@modelcontextprotocol/sdk` + `zod`), `node:test` via `npm test`, `.cabinet.env` for the connection string.

---

## Current context

- Documents are files. `readPage` loads Markdown from disk (`src/lib/storage/page-io.ts:128`). Navigation is a directory walk (`src/lib/storage/tree-builder.ts`).
- Cabinet already has SQLite at `DATA_DIR/.cabinet.db` (`src/lib/db.ts:12`, WAL at line 43) for app state (chat, Gmail credentials). It has no document table. Do not put the knowledge catalog there.
- Search is FlexSearch in the daemon (`server/search/index-builder.ts:17`), proxied by `src/app/api/search/route.ts`. Do not replace it in this slice.
- Agents have **no in-process tool loop**. CLIs are the MCP clients (`src/lib/agents/mcp-catalog.ts:5-12`). Agent file access today is the spawn cwd (`resolveAgentCwd` in `src/lib/storage/path-utils.ts:25`) plus `--add-dir` / `--plugin-dir`.
- First-party MCP pattern already exists: `mcps/mcp-telegram/`, catalog entry `TELEGRAM` (`src/lib/agents/mcp-catalog.ts:692`), config writer only touches `cabinet-<id>` (`src/lib/agents/mcp-config-writer.ts`).
- Per-room `knowledge-sources.json` is Connect Knowledge (Drive/iCloud mounts). Different product. Do not overload it in v1.
- Editor persona currently says “There is no database” (`src/lib/agents/library/editor/persona.md:53`). That remains true for pages. Do not rewrite it until the catalog MCP is real, then add a short “knowledge catalog is separate” note.

## Ownership rules (non-negotiable)

1. Each item has one authoritative home. Curated Cabinet pages stay files. Catalog records are not a second editable copy of those pages.
2. Registered source roots are explicit. Never index all of `DATA_DIR` or `$HOME` by default.
3. Agent file reads go through an allowlist resolver: realpath, must stay inside an enabled source root, size-capped, no path traversal.
4. Extracted facts cite a revision (`content_sha256` + quote/span). Source changes mark documents stale; records attached to an old hash are stale until re-accepted.
5. Agents cannot run arbitrary SQL. Parameterized catalog tools only.
6. Postgres is optional. Missing URL must not crash app, daemon, or Electron boot.

## Non-goals (v1)

- Replacing `page-io`, the tree, Git restore, or FlexSearch.
- Making Postgres the document editor.
- Vector search, DuckDB, Neo4j, MongoDB.
- Auto-extracting a knowledge graph from prose.
- Storing binary file bytes in Postgres.
- Putting the live database file on iCloud/Drive/Dropbox.
- Upstream PRs to `hilash/cabinet`.

## v1 schema

```sql
CREATE TABLE sources (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  root_path     text NOT NULL UNIQUE,
  policy        text NOT NULL CHECK (policy IN ('read-only', 'read-write')),
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id              uuid PRIMARY KEY,
  source_id       uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  rel_path        text NOT NULL,
  kind            text NOT NULL,
  content_sha256  text NOT NULL,
  byte_size       bigint NOT NULL,
  mtime           timestamptz,
  title           text,
  frontmatter     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL CHECK (status IN ('current', 'missing', 'error')),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, rel_path)
);

CREATE TABLE revisions (
  id              uuid PRIMARY KEY,
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content_sha256  text NOT NULL,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  plaintext       text,
  UNIQUE (document_id, content_sha256)
);

CREATE TABLE records (
  id            uuid PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision_id   uuid NOT NULL REFERENCES revisions(id),
  record_type   text NOT NULL,
  payload       jsonb NOT NULL,
  review_state  text NOT NULL DEFAULT 'extracted'
                CHECK (review_state IN ('extracted', 'accepted', 'rejected')),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence (
  id            uuid PRIMARY KEY,
  record_id     uuid NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  revision_id   uuid NOT NULL REFERENCES revisions(id),
  quote         text NOT NULL,
  line_start    integer,
  line_end      integer
);

CREATE INDEX documents_source_status_idx ON documents (source_id, status);
CREATE INDEX records_type_idx ON records (record_type, review_state);
```

`kind` values for v1: `markdown`, `text`, `pdf`, `spreadsheet`, `other`. Only `markdown`/`text` get `plaintext` extraction. PDFs and Office files are catalogued (path, hash, size, mtime) so agents can request a bounded read or a later extractor.

## Agent workflow this unlocks

1. `knowledge_search_documents` / `knowledge_query_records`
2. `knowledge_get_document` for metadata + stale flag
3. `knowledge_read_file` for the original (allowlisted, capped)
4. `knowledge_upsert_record` with quote + revision hash
5. Optional Markdown synthesis in the Cabinet page editor, which remains a file

---

### Task 1: Path allowlist and source-root resolver

**Objective:** Make file access decisions in one pure module with tests, before any Postgres or MCP code exists.

**Files:**
- Create: `src/lib/knowledge/types.ts`
- Create: `src/lib/knowledge/path-allowlist.ts`
- Test: `src/lib/knowledge/path-allowlist.test.ts`

**Step 1: Write failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { resolveKnowledgePath } from "./path-allowlist";

function source(root: string) {
  return { id: "src-1", name: "corpus", rootPath: root, policy: "read-only" as const, enabled: true };
}

test("accepts a file inside an enabled source root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-root-"));
  const file = path.join(root, "notes", "a.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "hi");
  const resolved = resolveKnowledgePath({
    requestedPath: file,
    sources: [source(root)],
    maxBytes: 1024,
  });
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.source.id, "src-1");
    assert.equal(resolved.relPath, path.join("notes", "a.md"));
    assert.equal(resolved.byteSize, 2);
  }
});

test("rejects path traversal out of the source root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-root-"));
  const outside = path.join(path.dirname(root), "secret.txt");
  fs.writeFileSync(outside, "no");
  const resolved = resolveKnowledgePath({
    requestedPath: path.join(root, "..", path.basename(outside)),
    sources: [source(root)],
    maxBytes: 1024,
  });
  assert.equal(resolved.ok, false);
});

test("rejects disabled sources and oversize files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-root-"));
  const file = path.join(root, "big.bin");
  fs.writeFileSync(file, Buffer.alloc(50));
  assert.equal(
    resolveKnowledgePath({
      requestedPath: file,
      sources: [{ ...source(root), enabled: false }],
      maxBytes: 10,
    }).ok,
    false,
  );
  assert.equal(
    resolveKnowledgePath({
      requestedPath: file,
      sources: [source(root)],
      maxBytes: 10,
    }).ok,
    false,
  );
});
```

**Step 2: Run test to verify failure**

```bash
npx tsx --test src/lib/knowledge/path-allowlist.test.ts
```

Expected: FAIL — module not found.

**Step 3: Minimal implementation**

- Canonicalize with `fs.realpathSync` after confirming the path exists.
- A requested path is allowed only if `resolved === root || resolved.startsWith(root + path.sep)`.
- Compute `relPath` with `path.relative(root, resolved)` using POSIX-or-platform separators consistently (store relative paths with `/`).
- Return `{ ok: false, reason }` for missing file, disabled source, traversal, directory, or `stat.size > maxBytes`.
- Do not read file contents here.

**Step 4: Re-run tests, expect PASS.**

**Step 5: Commit** `feat(knowledge): add allowlisted source-root path resolver`

---

### Task 2: Types, hash helper, and Postgres schema SQL

**Objective:** Freeze the v1 contract in TypeScript types and a SQL file the migrator can apply.

**Files:**
- Modify: `src/lib/knowledge/types.ts`
- Create: `src/lib/knowledge/hash.ts`
- Create: `src/lib/knowledge/schema.sql`
- Create: `src/lib/knowledge/migrations/001_initial.sql` (same SQL)
- Test: `src/lib/knowledge/hash.test.ts`

Hash helper: `sha256File(absPath): Promise<string>` using `node:crypto` streaming. Test against a known fixture (`hello` → `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`).

Types to export: `KnowledgeSource`, `KnowledgeDocument`, `KnowledgeRevision`, `KnowledgeRecord`, `KnowledgeEvidence`, `ResolveResult`.

Do not add `pg` yet.

Commit: `feat(knowledge): add catalog types, sha256 helper, and v1 schema`

---

### Task 3: Postgres client that is inert without a URL

**Objective:** Load `CABINET_KNOWLEDGE_DATABASE_URL` from env / `.cabinet.env` and either return a pool or a typed “unconfigured” result. Daemon boot must not throw.

**Files:**
- Create: `src/lib/knowledge/pg.ts`
- Create: `src/lib/knowledge/migrate.ts`
- Test: `src/lib/knowledge/pg.test.ts`
- Modify: `package.json` to add `pg` and `@types/pg` only in this task

Behavior:
- `getKnowledgeDatabaseUrl()` reads `process.env.CABINET_KNOWLEDGE_DATABASE_URL`.
- `getKnowledgePool()` returns `null` when unset/blank.
- `assertKnowledgeConfigured()` throws a `KnowledgeNotConfiguredError` with message “Set CABINET_KNOWLEDGE_DATABASE_URL in .cabinet.env”.
- `migrateKnowledgeSchema(pool)` applies `migrations/*.sql` using a `knowledge_schema_version` table. Do **not** reuse `runSqlMigrations` (`src/lib/system/sql-migrations.ts`); that helper is SQLite/`better-sqlite3` specific.
- Live migrate test: skip unless `CABINET_KNOWLEDGE_DATABASE_URL` is set. Document that in the test name.

Wiring: `loadCabinetEnv()` already runs in the daemon (`server/cabinet-daemon.ts:22-23`). Put the URL in `.cabinet.env`. Never log the URL.

Commit: `feat(knowledge): add optional Postgres pool and migrator`

---

### Task 4: Catalog repository (sources, documents, revisions)

**Objective:** Implement parameterized CRUD/ingest writes behind a repository module. No HTTP yet.

**Files:**
- Create: `src/lib/knowledge/repo.ts`
- Test: `src/lib/knowledge/repo.test.ts` (skip without URL)

Methods:
- `insertSource`, `listSources`, `disableSource`
- `upsertDocumentFromScan({ sourceId, relPath, absPath, stat, sha256, title?, frontmatter?, plaintext? })` — inserts revision if hash is new; updates `documents.status='current'`
- `markMissing(sourceId, seenRelPaths: string[])`
- `getDocumentById`, `searchDocuments({ query, sourceId, limit })` using `ILIKE` on `title` and `rel_path` for v1
- `insertRecord({ documentId, revisionId, recordType, payload, evidence, createdBy })` — reject if `revision.content_sha256 !== documents.content_sha256` unless `review_state='extracted'` on a stale revision (allowed, but returned with `stale: true`)

Use `pg` parameterized queries only (`$1`, `$2`). No string-concatenated SQL.

Commit: `feat(knowledge): add Postgres catalog repository`

---

### Task 5: Ingest scanner

**Objective:** Walk one registered source root, skip hidden/ignored names using `isHiddenEntry` from `src/lib/storage/path-utils.ts:67`, hash files, upsert, mark missing.

**Files:**
- Create: `src/lib/knowledge/ingest.ts`
- Test: `src/lib/knowledge/ingest.test.ts`

Pure scan function can be tested without Postgres by injecting a fake repo, or with a temp dir + skip-if-no-db.

Rules:
- Follow directory structure, do not follow symlinks out of the source root (`realpath` each file, skip if allowlist fails).
- Default max file size 8 MiB for hashing/plaintext; larger files get `status='error'` with no plaintext.
- Markdown: parse with `gray-matter` (already a dependency). Store complete frontmatter JSON and body plaintext. Do not use `readPage` — it trims body and fills default dates (`src/lib/storage/page-io.ts:187-191`).
- Return a summary: `{ scanned, upserted, missing, errors }`.

Commit: `feat(knowledge): ingest registered source roots into the catalog`

---

### Task 6: Daemon HTTP endpoints

**Objective:** Daemon owns the pool and exposes authenticated knowledge routes, same pattern as `/search`.

**Files:**
- Create: `server/knowledge/http.ts` (request router helpers)
- Modify: `server/cabinet-daemon.ts` to mount routes after auth
- Test: `server/knowledge/http.test.ts` for 401 without token, 503 when URL unset, 200 list-sources when configured

Routes (all require existing daemon bearer token — `isDaemonTokenValid`):
- `GET /knowledge/status` → `{ configured: boolean }`
- `GET /knowledge/sources`
- `POST /knowledge/sources` `{ name, rootPath, policy }` — `rootPath` must exist, be a directory, and pass a “not HOME, not filesystem root” guard (same spirit as `bootstrapCabinetAt`)
- `POST /knowledge/sources/:id/ingest`
- `GET /knowledge/documents?q=&sourceId=`
- `GET /knowledge/documents/:id`
- `POST /knowledge/records`
- `GET /knowledge/records?type=&documentId=`
- `GET /knowledge/files?path=` → bounded text read through allowlist; 403 on miss

On unconfigured: HTTP 503 `{ error: "knowledge_unconfigured", hint: "Set CABINET_KNOWLEDGE_DATABASE_URL" }`.

Lazy-init pool on first knowledge request so daemon boot stays cheap.

Commit: `feat(knowledge): expose catalog routes on the daemon`

---

### Task 7: App proxy API

**Objective:** Operator/UI and local tools call Next routes; those proxy to the daemon like search.

**Files:**
- Create: `src/app/api/knowledge/status/route.ts`
- Create: `src/app/api/knowledge/sources/route.ts`
- Create: `src/app/api/knowledge/sources/[id]/ingest/route.ts`
- Create: `src/app/api/knowledge/documents/route.ts`
- Create: `src/app/api/knowledge/documents/[id]/route.ts`
- Create: `src/app/api/knowledge/records/route.ts`
- Modify: `src/lib/agents/daemon-client.ts` only if a shared `daemonFetch` export is cleaner than copying the search route’s fetch. Prefer exporting `daemonFetch` from `daemon-client.ts` rather than duplicating bearer-token fetch in every route.

No new UI in this task.

Commit: `feat(knowledge): proxy catalog APIs through Next.js`

---

### Task 8: First-party MCP server for agents

**Objective:** Give CLIs a stdio MCP server so agents can use the catalog without arbitrary filesystem or SQL access.

**Files (copy `mcps/mcp-telegram/` layout):**
- Create: `mcps/mcp-knowledge/package.json` (`cabinet-mcp-knowledge`, bin `cabinet-mcp-knowledge`)
- Create: `mcps/mcp-knowledge/src/index.ts`
- Create: `mcps/mcp-knowledge/src/tools.ts`
- Create: `mcps/mcp-knowledge/src/client.ts` (HTTP to daemon)
- Create: `mcps/mcp-knowledge/esbuild.config.mjs`, `tsconfig.json`, `scripts/smoke.mjs`, `README.md`

Env (injected from `.cabinet.env`, never written into CLI config):
- `CABINET_DAEMON_URL`
- `CABINET_DAEMON_TOKEN` (or read the same token file if present)
- Do **not** give the MCP process `CABINET_KNOWLEDGE_DATABASE_URL`. It talks to the daemon so allowlist + auth stay in one place.

Tools:
- `knowledge_list_sources`
- `knowledge_search_documents` `{ query, sourceId?, limit? }`
- `knowledge_get_document` `{ id }`
- `knowledge_read_file` `{ path }` — daemon still enforces allowlist and max bytes
- `knowledge_query_records` `{ recordType?, documentId?, reviewState? }`
- `knowledge_upsert_record` `{ documentId, revisionId, recordType, payload, quote, lineStart?, lineEnd? }`

Smoke script: spawn with missing env and expect a clear stderr + non-zero exit.

Commit: `feat(knowledge): add cabinet-mcp-knowledge stdio server`

---

### Task 9: Register the MCP in Cabinet’s catalog

**Objective:** Operators can connect it from Settings → Integrations like Telegram.

**Files:**
- Modify: `src/lib/agents/mcp-catalog.ts` — add `KNOWLEDGE` entry and include it in `MCP_CATALOG`
- Modify: `test/mcp-catalog-invariants.test.ts` only if a new invariant is needed
- Modify: `src/lib/integrations/preview-catalog.ts` only if the hub requires a preview card (it auto-picks catalog entries; verify before editing)

Catalog shape (match Telegram):
- `id: "knowledge"`
- `trustTier: "cabinet"`
- `authBackend: "token"` (reusing the token backend for “credentials in .cabinet.env”; connection string is the credential)
- `transport: "stdio"`
- `mcpServerName: "cabinet-knowledge"`
- `command: "node"` / `args` pointing at `localBuild: "mcps/mcp-knowledge/dist/index.js"` for dev; published `npx -y cabinet-mcp-knowledge@…` can wait
- `serverEnv`: `CABINET_DAEMON_URL` and `CABINET_DAEMON_TOKEN` placeholders
- `credentials`: `CABINET_KNOWLEDGE_DATABASE_URL` as `kind: "secret"` so the operator pastes it into `.cabinet.env`. The MCP process itself does not read it; the daemon does. Setup copy must say that.

Verify `mcp-config-writer` will write only `cabinet-knowledge`.

Commit: `feat(knowledge): register knowledge MCP in the integrations catalog`

---

### Task 10: Docs, persona note, changelog

**Objective:** Record how to run it and stop agents from treating the catalog as a second page store.

**Files:**
- Create: `docs/KNOWLEDGE_CATALOG.md` — ownership rules, env var, register source, ingest, MCP tools, backup (`pg_dump`), “do not sync the data directory of Postgres via iCloud”
- Modify: `src/lib/agents/library/editor/persona.md` — replace the blanket “there is no database” line with: pages are files; the optional knowledge catalog is queried through MCP and does not replace page edits
- Modify: `docs/CLAUDE.md` — add rule 20: knowledge catalog is optional Postgres, not `.cabinet.db`, not a replacement for `/data` pages
- Modify: `PROGRESS.md` — one dated entry

Copy: no em-dashes, no sparkles.

Commit: `docs(knowledge): describe the optional Postgres catalog`

---

## Files likely to change (summary)

| Area | Path |
|---|---|
| Domain | `src/lib/knowledge/*` |
| Daemon | `server/knowledge/http.ts`, `server/cabinet-daemon.ts` |
| App proxy | `src/app/api/knowledge/**` |
| MCP | `mcps/mcp-knowledge/**`, `src/lib/agents/mcp-catalog.ts` |
| Docs | `docs/KNOWLEDGE_CATALOG.md`, `docs/CLAUDE.md`, `PROGRESS.md`, editor persona |
| Deps | `package.json` (`pg`) |

Do not modify `src/lib/storage/page-io.ts`, `server/search/*`, or `server/migrations/*.sql`.

## Tests / validation

```bash
npx tsx --test src/lib/knowledge/path-allowlist.test.ts src/lib/knowledge/hash.test.ts src/lib/knowledge/pg.test.ts
npx tsc -p tsconfig.json --noEmit
npx eslint src/lib/knowledge server/knowledge src/app/api/knowledge
npm test   # full unit suite; knowledge live-db tests skip without URL
```

With a throwaway database:

```bash
# example only; operator-provided URL
CABINET_KNOWLEDGE_DATABASE_URL=postgres://cabinet:cabinet@127.0.0.1:5432/cabinet_knowledge \
  npx tsx --test src/lib/knowledge/repo.test.ts src/lib/knowledge/ingest.test.ts
```

Manual: daemon up, `GET /knowledge/status` → `configured: false` without URL; with URL, register a temp corpus, ingest, search, MCP smoke.

## Risks, tradeoffs, open questions

- **Postgres is an operational dependency.** v1 is opt-in via env. Do not auto-install Postgres inside Electron.
- **Allowlist bugs are data-exfil bugs.** Task 1 is the security gate; MCP and HTTP must call it, not reimplement path joins.
- **Ingest freshness.** v1 is explicit `POST .../ingest`, not a second chokidar. Search already has a symlink-watch gap (`server/search/watcher.ts`); do not copy that bug. A later task can add a periodic daemon ingest.
- **Duplicate identity.** The same file reachable via two registered roots must remain two documents unless we add a realpath unique key later. v1: unique `(source_id, rel_path)` only.
- **Agent cwd vs catalog.** Agents can still edit files in their room cwd. The catalog does not grant write to source roots in v1 (`policy` is stored; writes are not implemented). Read-write policy is reserved.
- **Where Postgres runs** (local Docker, mini, existing instance) is an operator choice. Not blocked on this plan.
- **First corpus to register** is not chosen here. Implement the mechanism; Dom picks the roots.

## Rollout

1. Ship Tasks 1–7 with tests; knowledge APIs exist, UI unchanged.
2. Connect MCP (Tasks 8–9) on the running Cabinet.
3. Register one real source, ingest, run one agent question that must cite `content_sha256`.
4. Only then consider typed extractors, FTS, or a small operator UI.
