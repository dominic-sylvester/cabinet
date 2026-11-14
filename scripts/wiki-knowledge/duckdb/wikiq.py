#!/usr/bin/env python3
"""Query the raw-wiki DuckDB index. No Postgres, no container.

Same JSON contract as scripts/wiki-knowledge/cli.mjs (list / search / read /
stats), backed by a DuckDB file plus the on-disk Markdown as byte authority.

    uv run --quiet --with duckdb python3 wikiq.py stats
    uv run --quiet --with duckdb python3 wikiq.py list --category howard-marks --limit 5
    uv run --quiet --with duckdb python3 wikiq.py search 'margin AND safety' --limit 5
    uv run --quiet --with duckdb python3 wikiq.py read 'howard-marks/MANIFEST.md' --limit 4000
    uv run --quiet --with duckdb python3 wikiq.py read <doc-id> --revision <sha256> --full

`read` re-reads bytes from disk and refuses to return text whose SHA-256 does not
match the indexed hash (drifted source), unless --allow-drift is passed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys

import duckdb

DEFAULT_DB = os.path.expanduser("~/Development/investment-brain-data/wiki-index/wiki.duckdb")
EXCERPT_CHARS = 1600


def connect(db_path: str) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(db_path, read_only=True)
    con.execute("LOAD fts")
    return con


def excerpt(text: str, query: str, width: int = EXCERPT_CHARS) -> str:
    terms = [t for t in re.split(r"[^0-9A-Za-z]+", query) if t and t.upper() not in ("AND", "OR", "NOT")]
    low, hit = text.lower(), -1
    for t in terms:
        hit = low.find(t.lower())
        if hit >= 0:
            break
    if hit < 0:
        return text[:width]
    start = max(0, hit - width // 3)
    return ("…" if start else "") + text[start:start + width]


def cmd_stats(con) -> dict:
    meta = dict(con.execute("SELECT k, v FROM meta").fetchall())
    docs, byt = con.execute("SELECT count(*), sum(bytes) FROM documents").fetchone()
    chunks, nchars = con.execute("SELECT count(*), sum(nchars) FROM chunks").fetchone()
    cats = con.execute(
        "SELECT category, count(*), sum(bytes) FROM documents GROUP BY 1 ORDER BY 2 DESC"
    ).fetchall()
    return {
        "documents": docs, "chunks": chunks, "source_bytes": byt,
        "index_bytes": os.path.getsize(DEFAULT_DB) if os.path.exists(DEFAULT_DB) else None,
        "categories": [{"category": c, "documents": n, "bytes": b} for c, n, b in cats],
        "meta": meta,
    }


def cmd_list(con, category: str | None, limit: int, offset: int) -> dict:
    where, params = ("WHERE category = ?", [category]) if category else ("", [])
    total = con.execute(f"SELECT count(*) FROM documents {where}", params).fetchone()[0]
    rows = con.execute(
        f"SELECT id, path, category, bytes, reason FROM documents {where} "
        f"ORDER BY path LIMIT ? OFFSET ?", params + [limit, offset]
    ).fetchall()
    return {
        "total": total, "offset": offset, "limit": limit,
        "truncated": offset + len(rows) < total,
        "results": [{"id": i, "path": p, "category": c, "bytes": b, "reason": r}
                    for i, p, c, b, r in rows],
    }


def cmd_search(con, query: str, category: str | None, limit: int, offset: int) -> dict:
    cat_sql = "AND d.category = ?" if category else ""
    params = [query] + ([category] if category else []) + [offset + limit, offset]
    rows = con.execute(f"""
        WITH scored AS (
            SELECT c.doc_id, c.ordinal, c.text, c.nchars,
                   fts_main_chunks.match_bm25(c.id, ?) AS score
            FROM chunks AS c
        ), best AS (
            SELECT doc_id, max(score) AS score FROM scored WHERE score IS NOT NULL GROUP BY 1
        ), ranked AS (
            SELECT s.doc_id, s.ordinal, s.text, s.score,
                   row_number() OVER (PARTITION BY s.doc_id ORDER BY s.score DESC, s.ordinal) AS rn
            FROM scored s JOIN best b USING (doc_id)
            WHERE s.score = b.score
        )
        SELECT r.doc_id, d.path, d.category, r.ordinal, r.score, r.text
        FROM ranked r JOIN documents d ON d.id = r.doc_id
        WHERE r.rn = 1 {cat_sql}
        ORDER BY r.score DESC, d.path
        LIMIT ? OFFSET ?
    """, params).fetchall()
    total = con.execute(f"""
        SELECT count(DISTINCT c.doc_id) FROM chunks AS c
        JOIN documents d ON d.id = c.doc_id
        WHERE fts_main_chunks.match_bm25(c.id, ?) IS NOT NULL {cat_sql}
    """, [query] + ([category] if category else [])).fetchone()[0]
    return {
        "total": total, "offset": offset, "limit": limit,
        "truncated": offset + len(rows) < total,
        "results": [{
            "id": i, "path": p, "category": c, "chunk_ordinal": o,
            "score": round(s, 4), "excerpt": excerpt(t, query),
        } for i, p, c, o, s, t in rows],
    }


def cmd_read(con, ident: str, revision: str | None, offset: int, limit: int,
             section: str | None, full: bool, allow_drift: bool) -> dict:
    row = con.execute(
        "SELECT id, path, abs_path, sha256, bytes, reason FROM documents "
        "WHERE id = ? OR path = ? LIMIT 1", [ident, ident]
    ).fetchone()
    if not row:
        return {"error": "not_found", "identifier": ident}
    doc_id, path, abs_path, sha, size, reason = row
    if revision and revision != sha:
        return {"error": "revision_not_found", "path": path, "revision": revision,
                "current": sha}
    with open(abs_path, "rb") as fh:
        raw = fh.read()
    actual = hashlib.sha256(raw).hexdigest()
    drift = actual != sha
    if drift and not allow_drift:
        return {"error": "source_drift", "path": path, "indexed": sha, "actual": actual}
    text = raw.decode("utf-8", errors="replace")
    method = "lossless_utf8"
    if reason == "nul":
        text, method = text.replace("\x00", ""), "nul_removed"
    if section:
        pat = re.compile(rf"^#+\s+{re.escape(section)}\s*$", re.M)
        m = pat.search(text)
        if not m:
            return {"error": "section_not_found", "path": path, "section": section}
        start = m.start()
        nxt = re.compile(r"^#{1,6}\s+", re.M).search(text, m.end())
        text = text[start:nxt.start() if nxt else len(text)]
    out = {
        "id": doc_id, "path": path, "revision": actual, "bytes": size,
        "derived": reason == "nul", "reason": reason, "text_method": method,
        "drift": drift, "total_chars": len(text),
    }
    if not full:
        page = text[offset:offset + limit]
        out.update({"offset": offset, "limit": limit, "text": page,
                    "truncated": offset + len(page) < len(text)})
    else:
        out["text"] = text
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats")
    p = sub.add_parser("list"); p.add_argument("--category"); p.add_argument("--limit", type=int, default=50); p.add_argument("--offset", type=int, default=0)
    p = sub.add_parser("search"); p.add_argument("query"); p.add_argument("--category"); p.add_argument("--limit", type=int, default=20); p.add_argument("--offset", type=int, default=0)
    p = sub.add_parser("read"); p.add_argument("ident"); p.add_argument("--revision"); p.add_argument("--offset", type=int, default=0); p.add_argument("--limit", type=int, default=12000); p.add_argument("--section"); p.add_argument("--full", action="store_true"); p.add_argument("--allow-drift", action="store_true")
    a = ap.parse_args()

    if not os.path.exists(a.db):
        print(json.dumps({"error": "index_missing", "db": a.db}))
        return 1
    con = connect(a.db)
    try:
        if a.cmd == "stats":   res = cmd_stats(con)
        elif a.cmd == "list":  res = cmd_list(con, a.category, a.limit, a.offset)
        elif a.cmd == "search":res = cmd_search(con, a.query, a.category, a.limit, a.offset)
        else:                  res = cmd_read(con, a.ident, a.revision, a.offset, a.limit, a.section, a.full, a.allow_drift)
    finally:
        con.close()
    print(json.dumps(res, ensure_ascii=False))
    return 0 if "error" not in res else 2


if __name__ == "__main__":
    sys.exit(main())
