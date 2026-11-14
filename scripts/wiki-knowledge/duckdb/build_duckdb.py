#!/usr/bin/env python3
"""Build the raw-wiki DuckDB index — no Postgres, no container.

Filesystem is the authority for bytes. This index stores derived metadata plus
chunked search text only: raw Markdown is read from disk on demand and
hash-verified against `documents.sha256`, so there is exactly one authoritative
copy of the corpus.

    uv run --quiet --with duckdb python3 build_duckdb.py \
        --root  ~/Development/investment-brain-data/raw \
        --manifest ~/Development/cabinet/data/.cabinet-state/knowledge/raw-wiki-v1.json \
        --out   ~/Development/investment-brain-data/wiki-index/wiki.duckdb

Verification: every file's SHA-256 is recomputed from disk and compared to the
manifest. Any mismatch aborts before the index is published (temp file + rename).
U+0000 is stripped from the FTS copy only (documented transformation, mirrors the
Postgres importer); the on-disk bytes are never modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

import duckdb

CHUNK_BYTES = 12288  # matches the Postgres importer's chunking bound


def chunk_text(text: str) -> list[str]:
    """Paragraph-preferred chunks, never exceeding CHUNK_BYTES characters."""
    paras, buf, out = text.split("\n\n"), "", []
    for p in paras:
        piece = (buf + "\n\n" + p) if buf else p
        while len(piece) > CHUNK_BYTES:
            if buf:
                out.append(buf)
                buf, piece = "", p
                continue
            out.append(piece[:CHUNK_BYTES])
            piece = piece[CHUNK_BYTES:]
        buf = piece
    if buf:
        out.append(buf)
    return [c for c in out if c.strip()] or ([text[:CHUNK_BYTES]] if text.strip() else [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    root = os.path.expanduser(args.root)
    manifest = json.load(open(os.path.expanduser(args.manifest)))
    files = manifest["files"]

    t0 = time.time()
    bad, rows, chunks = [], [], []
    for f in files:
        abs_path = os.path.join(root, f["path"])
        try:
            with open(abs_path, "rb") as fh:
                raw = fh.read()
        except OSError as exc:
            bad.append((f["path"], f"unreadable: {exc}"))
            continue
        digest = hashlib.sha256(raw).hexdigest()
        if digest != f["sha256"]:
            bad.append((f["path"], f"sha256 {digest[:12]} != {f['sha256'][:12]}"))
            continue
        if len(raw) != f["bytes"]:
            bad.append((f["path"], f"size {len(raw)} != {f['bytes']}"))
            continue
        st = os.stat(abs_path)
        text = raw.decode("utf-8", errors="replace")
        searchable = text.replace("\x00", "")
        rows.append(
            (f["id"], f["path"], f["category"], f["sha256"], f["bytes"],
             st.st_mtime, f.get("reason"), abs_path)
        )
        for i, c in enumerate(chunk_text(searchable)):
            chunks.append((f"{f['id']}:{i}", f["id"], i, c, len(c)))

    if bad:
        print(f"FAIL — {len(bad)} file(s) disagree with the manifest:", file=sys.stderr)
        for p, why in bad[:20]:
            print(f"  {p}: {why}", file=sys.stderr)
        return 1

    out = os.path.expanduser(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp"
    for p in (tmp, tmp + ".wal"):
        if os.path.exists(p):
            os.remove(p)

    con = duckdb.connect(tmp)
    con.execute("""
        CREATE TABLE documents(
            id VARCHAR PRIMARY KEY, path VARCHAR, category VARCHAR,
            sha256 VARCHAR, bytes BIGINT, mtime DOUBLE,
            reason VARCHAR, abs_path VARCHAR)
    """)
    con.execute("""
        CREATE TABLE chunks(
            id VARCHAR PRIMARY KEY, doc_id VARCHAR, ordinal INTEGER,
            text VARCHAR, nchars INTEGER)
    """)
    con.executemany("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)", rows)
    con.executemany("INSERT INTO chunks VALUES (?,?,?,?,?)", chunks)
    con.execute("INSTALL fts")
    con.execute("LOAD fts")
    con.execute(
        "PRAGMA create_fts_index('chunks','id','text', stemmer='none', "
        "strip_accents=0, lower=1, overwrite=1)"
    )
    con.execute("CREATE TABLE meta(k VARCHAR, v VARCHAR)")
    con.executemany(
        "INSERT INTO meta VALUES (?,?)",
        [
            ("manifest_checksum", manifest["checksum"]),
            ("manifest_version", str(manifest["version"])),
            ("import_id", manifest["import_id"]),
            ("root", root),
            ("built_at", time.strftime("%Y-%m-%dT%H:%M:%S%z")),
            ("documents", str(len(rows))),
            ("chunks", str(len(chunks))),
            ("source_bytes", str(sum(f["bytes"] for f in files))),
        ],
    )
    con.execute("CHECKPOINT")
    con.close()

    if os.path.exists(out):
        os.replace(out, out + ".prev")
    os.replace(tmp, out)
    if os.path.exists(out + ".prev"):
        os.remove(out + ".prev")

    print(json.dumps({
        "out": out,
        "documents": len(rows),
        "chunks": len(chunks),
        "source_bytes": sum(f["bytes"] for f in files),
        "index_bytes": os.path.getsize(out),
        "hashes_verified": len(rows),
        "manifest_checksum": manifest["checksum"],
        "seconds": round(time.time() - t0, 1),
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
