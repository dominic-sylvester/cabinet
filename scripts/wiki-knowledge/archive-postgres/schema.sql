BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS cabinet_wiki_v1;
CREATE TABLE IF NOT EXISTS cabinet_wiki_v1.schema_version (version integer PRIMARY KEY CHECK (version = 1));
INSERT INTO cabinet_wiki_v1.schema_version VALUES (1) ON CONFLICT DO NOTHING;
-- Match whole hexadecimal byte pairs: remove only 00 bytes, never nibble crossings.
-- Fatal PostgreSQL UTF8 decoding still rejects invalid UTF8 rather than replacing it.
CREATE OR REPLACE FUNCTION cabinet_wiki_v1.nul_removed_utf8(bytes bytea)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
 SELECT convert_from(decode(regexp_replace(encode(bytes,'hex'),'00|(..)','\1','g'),'hex'),'UTF8')
$fn$;
CREATE TABLE IF NOT EXISTS cabinet_wiki_v1.documents (
  id uuid PRIMARY KEY, path text NOT NULL UNIQUE, category text NOT NULL
);
CREATE TABLE IF NOT EXISTS cabinet_wiki_v1.revisions (
  document_id uuid NOT NULL REFERENCES cabinet_wiki_v1.documents(id),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  raw_bytes bytea NOT NULL, raw_markdown text, searchable boolean NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, sha256),
  CHECK (encode(digest(raw_bytes,'sha256'),'hex') = sha256),
  CONSTRAINT revisions_lossless_bytes CHECK (raw_markdown IS NULL OR convert_to(raw_markdown,'UTF8') = raw_bytes)
);
-- Additive upgrade of the original v1 representation, in the same transaction.
-- Original raw bytes, hashes, document/revision IDs and generation membership never change.
ALTER TABLE cabinet_wiki_v1.revisions ADD COLUMN IF NOT EXISTS search_text text;
-- The original schema's second unnamed table CHECK coupled reason to nonsearchability.
ALTER TABLE cabinet_wiki_v1.revisions DROP CONSTRAINT IF EXISTS revisions_check1;
UPDATE cabinet_wiki_v1.revisions SET search_text=raw_markdown
 WHERE search_text IS NULL AND raw_markdown IS NOT NULL;
UPDATE cabinet_wiki_v1.revisions SET search_text=cabinet_wiki_v1.nul_removed_utf8(raw_bytes), searchable=true
 WHERE reason='nul' AND search_text IS NULL;
DO $migration$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='cabinet_wiki_v1.revisions'::regclass AND conname='revisions_text_representation') THEN
  ALTER TABLE cabinet_wiki_v1.revisions ADD CONSTRAINT revisions_text_representation CHECK ((
   (reason IS NULL AND searchable AND raw_markdown IS NOT NULL AND search_text=raw_markdown)
   OR (reason='nul' AND searchable AND raw_markdown IS NULL AND search_text IS NOT NULL
       AND position(decode('00','hex') IN raw_bytes)>0
       AND search_text=cabinet_wiki_v1.nul_removed_utf8(raw_bytes))
   OR (reason='invalid_utf8' AND NOT searchable AND raw_markdown IS NULL AND search_text IS NULL)
  ) IS TRUE);
 END IF;
END $migration$;
CREATE TABLE IF NOT EXISTS cabinet_wiki_v1.chunks (
  document_id uuid NOT NULL, sha256 text NOT NULL, ordinal integer NOT NULL,
  body text NOT NULL CHECK (octet_length(body) <= 12288),
  terms tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig,body)) STORED,
  PRIMARY KEY (document_id,sha256,ordinal),
  FOREIGN KEY (document_id,sha256) REFERENCES cabinet_wiki_v1.revisions(document_id,sha256)
);
-- Previously byte-only NUL revisions had no chunks. Bound by 3072 Unicode chars
-- (at most 12288 UTF8 bytes). Ordinary/reimported revision chunks stay unchanged.
INSERT INTO cabinet_wiki_v1.chunks(document_id,sha256,ordinal,body)
 SELECT r.document_id,r.sha256,((n-1)/3072+1),substring(r.search_text FROM n FOR 3072)
 FROM cabinet_wiki_v1.revisions r CROSS JOIN LATERAL generate_series(1,char_length(r.search_text),3072) n
 WHERE r.reason='nul' AND NOT EXISTS (
  SELECT 1 FROM cabinet_wiki_v1.chunks c WHERE c.document_id=r.document_id AND c.sha256=r.sha256);
CREATE INDEX IF NOT EXISTS wiki_chunks_terms ON cabinet_wiki_v1.chunks USING gin(terms);
CREATE TABLE IF NOT EXISTS cabinet_wiki_v1.imports (
  id uuid PRIMARY KEY, status text NOT NULL CHECK (status IN ('loading','complete')),
  manifest jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cabinet_wiki_v1.members (
  import_id uuid NOT NULL REFERENCES cabinet_wiki_v1.imports(id),
  document_id uuid NOT NULL, sha256 text NOT NULL,
  PRIMARY KEY (import_id,document_id),
  FOREIGN KEY (document_id,sha256) REFERENCES cabinet_wiki_v1.revisions(document_id,sha256)
);
CREATE TABLE IF NOT EXISTS cabinet_wiki_v1.active (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  import_id uuid NOT NULL REFERENCES cabinet_wiki_v1.imports(id)
);
CREATE OR REPLACE VIEW cabinet_wiki_v1.current_documents AS
 SELECT d.*, r.sha256, r.raw_bytes,r.raw_markdown,r.searchable,r.reason,r.search_text
 FROM cabinet_wiki_v1.active a
 JOIN cabinet_wiki_v1.members m ON m.import_id=a.import_id
 JOIN cabinet_wiki_v1.documents d ON d.id=m.document_id
 JOIN cabinet_wiki_v1.revisions r ON r.document_id=m.document_id AND r.sha256=m.sha256;
COMMIT;
