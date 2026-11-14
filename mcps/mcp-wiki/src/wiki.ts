import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * Read-only access to the raw-wiki DuckDB index.
 *
 * The index stores derived metadata and chunked search text only. Raw Markdown
 * stays on disk and is re-hashed on every read, so a drifted source is reported
 * rather than silently quoted at the wrong revision.
 */

export const DEFAULT_DB = path.join(
  homedir(),
  "Development/investment-brain-data/wiki-index/wiki.duckdb",
);

const EXCERPT_CHARS = 1600;

export type DocRow = {
  id: string;
  path: string;
  category: string;
  bytes: number;
  reason: string | null;
};

export type SearchHit = DocRow & {
  chunk_ordinal: number;
  score: number;
  excerpt: string;
};

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

/**
 * First-term-centred excerpt. DuckDB FTS exposes no highlight/snippet
 * equivalent of Postgres `ts_headline`, so the window is computed here.
 */
export function excerpt(text: string, query: string, width = EXCERPT_CHARS): string {
  const terms = query
    .split(/[^0-9A-Za-z]+/)
    .filter((t) => t.length > 0 && !["AND", "OR", "NOT"].includes(t.toUpperCase()));
  const lower = text.toLowerCase();
  let hit = -1;
  for (const term of terms) {
    hit = lower.indexOf(term.toLowerCase());
    if (hit >= 0) break;
  }
  if (hit < 0) return text.slice(0, width);
  const start = Math.max(0, hit - Math.floor(width / 3));
  return (start > 0 ? "…" : "") + text.slice(start, start + width);
}

export class Wiki {
  private constructor(
    private readonly con: DuckDBConnection,
    readonly dbPath: string,
  ) {}

  static async open(dbPath = process.env.WIKI_DUCKDB?.trim() || DEFAULT_DB): Promise<Wiki> {
    const instance = await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
    const con = await instance.connect();
    await loadFts(con);
    return new Wiki(con, dbPath);
  }

  private async rows(sql: string, params: DuckDBValue[] = []): Promise<Row[]> {
    const reader = await this.con.runAndReadAll(sql, params);
    return reader.getRowObjects() as Row[];
  }

  async stats(): Promise<Record<string, unknown>> {
    const metaRows = await this.rows("SELECT k, v FROM meta");
    const [docs] = await this.rows("SELECT count(*) AS n, sum(bytes) AS b FROM documents");
    const [chunks] = await this.rows("SELECT count(*) AS n FROM chunks");
    const cats = await this.rows(
      "SELECT category, count(*) AS n, sum(bytes) AS b FROM documents GROUP BY 1 ORDER BY 2 DESC",
    );
    return {
      documents: num(docs?.n),
      chunks: num(chunks?.n),
      source_bytes: num(docs?.b),
      categories: cats.map((c) => ({
        category: str(c.category),
        documents: num(c.n),
        bytes: num(c.b),
      })),
      meta: Object.fromEntries(metaRows.map((r) => [str(r.k), str(r.v)])),
      index: this.dbPath,
    };
  }

  async list(category: string | undefined, limit: number, offset: number) {
    const where = category ? "WHERE category = ?" : "";
    const params: DuckDBValue[] = category ? [category] : [];
    const [total] = await this.rows(`SELECT count(*) AS n FROM documents ${where}`, params);
    const rows = await this.rows(
      `SELECT id, path, category, bytes, reason FROM documents ${where}
       ORDER BY path LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const results: DocRow[] = rows.map((r) => ({
      id: str(r.id),
      path: str(r.path),
      category: str(r.category),
      bytes: num(r.bytes),
      reason: r.reason === null || r.reason === undefined ? null : str(r.reason),
    }));
    return {
      total: num(total?.n),
      offset,
      limit,
      truncated: offset + results.length < num(total?.n),
      results,
    };
  }

  async search(
    query: string,
    category: string | undefined,
    limit: number,
    offset: number,
  ) {
    const catSql = category ? "AND d.category = ?" : "";
    const params: DuckDBValue[] = [query, ...(category ? [category] : []), limit, offset];
    const rows = await this.rows(
      `WITH scored AS (
         SELECT c.doc_id, c.ordinal, c.text,
                fts_main_chunks.match_bm25(c.id, ?) AS score
         FROM chunks AS c
       ), best AS (
         SELECT doc_id, max(score) AS score FROM scored WHERE score IS NOT NULL GROUP BY 1
       ), ranked AS (
         SELECT s.doc_id, s.ordinal, s.text, s.score,
                row_number() OVER (PARTITION BY s.doc_id ORDER BY s.score DESC, s.ordinal) AS rn
         FROM scored s JOIN best b USING (doc_id) WHERE s.score = b.score
       )
       SELECT r.doc_id, d.path, d.category, d.bytes, d.reason, r.ordinal, r.score, r.text
       FROM ranked r JOIN documents d ON d.id = r.doc_id
       WHERE r.rn = 1 ${catSql}
       ORDER BY r.score DESC, d.path
       LIMIT ? OFFSET ?`,
      params,
    );
    const [total] = await this.rows(
      `SELECT count(DISTINCT c.doc_id) AS n FROM chunks AS c
       JOIN documents d ON d.id = c.doc_id
       WHERE fts_main_chunks.match_bm25(c.id, ?) IS NOT NULL ${catSql}`,
      [query, ...(category ? [category] : [])],
    );
    const results: SearchHit[] = rows.map((r) => ({
      id: str(r.doc_id),
      path: str(r.path),
      category: str(r.category),
      bytes: num(r.bytes),
      reason: r.reason === null || r.reason === undefined ? null : str(r.reason),
      chunk_ordinal: num(r.ordinal),
      score: Math.round(num(r.score) * 10000) / 10000,
      excerpt: excerpt(str(r.text), query),
    }));
    return {
      total: num(total?.n),
      offset,
      limit,
      truncated: offset + results.length < num(total?.n),
      results,
    };
  }

  async read(opts: {
    identifier: string;
    revision?: string;
    section?: string;
    offset: number;
    limit: number;
    full: boolean;
    allowDrift: boolean;
  }): Promise<Record<string, unknown>> {
    const [row] = await this.rows(
      `SELECT id, path, abs_path, sha256, bytes, reason FROM documents
       WHERE id = ? OR path = ? LIMIT 1`,
      [opts.identifier, opts.identifier],
    );
    if (!row) return { error: "not_found", identifier: opts.identifier };

    const docId = str(row.id);
    const docPath = str(row.path);
    const absPath = str(row.abs_path);
    const indexed = str(row.sha256);
    const reason = row.reason === null || row.reason === undefined ? null : str(row.reason);

    if (opts.revision && opts.revision !== indexed) {
      return { error: "revision_not_found", path: docPath, revision: opts.revision, current: indexed };
    }

    let raw: Buffer;
    try {
      raw = readFileSync(absPath);
    } catch (err) {
      return {
        error: "source_unreadable",
        path: docPath,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    const actual = createHash("sha256").update(raw).digest("hex");
    const drift = actual !== indexed;
    if (drift && !opts.allowDrift) {
      return { error: "source_drift", path: docPath, indexed, actual };
    }

    let text = raw.toString("utf8");
    let textMethod = "lossless_utf8";
    if (reason === "nul") {
      text = text.replace(/\u0000/g, "");
      textMethod = "nul_removed";
    }

    if (opts.section) {
      const lines = text.split("\n");
      const escaped = opts.section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const heading = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`);
      const start = lines.findIndex((l) => heading.test(l));
      if (start < 0) return { error: "section_not_found", path: docPath, section: opts.section };
      const level = (lines[start].match(/^#+/) ?? [""])[0].length;
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i += 1) {
        const m = lines[i].match(/^(#{1,6})\s+/);
        if (m && m[1].length <= level) {
          end = i;
          break;
        }
      }
      text = lines.slice(start, end).join("\n");
    }

    const out: Record<string, unknown> = {
      id: docId,
      path: docPath,
      revision: actual,
      bytes: num(row.bytes),
      derived: reason === "nul",
      reason,
      text_method: textMethod,
      drift,
      total_chars: text.length,
    };
    if (opts.full) {
      out.text = text;
    } else {
      const page = text.slice(opts.offset, opts.offset + opts.limit);
      out.offset = opts.offset;
      out.limit = opts.limit;
      out.text = page;
      out.truncated = opts.offset + page.length < text.length;
    }
    return out;
  }

  close(): void {
    this.con.closeSync();
  }
}

async function loadFts(con: DuckDBConnection): Promise<void> {
  try {
    await con.run("LOAD fts");
  } catch {
    // Extension not cached yet: install once, then load. Offline installs that
    // already cached it never reach this branch.
    await con.run("INSTALL fts");
    await con.run("LOAD fts");
  }
}
