import test from 'node:test';
import assert from 'node:assert/strict';

test('lossless rows, stable path identity, invalid text exclusion and bounded chunks', async () => {
  const { makeRow, chunks, sqlText, manifestDigest } = await import('./core.mjs');
  const a = makeRow('letters/a.md', Buffer.from('\uFEFF# Hello\r\n\nworld 😀'));
  assert.equal(Buffer.from(a.raw, 'base64').toString(), '\uFEFF# Hello\r\n\nworld 😀');
  assert.equal(a.id, makeRow('letters/a.md', Buffer.from('changed')).id);
  assert.notEqual(a.id, makeRow('letters/b.md', Buffer.from('changed')).id);
  assert.equal(a.text, '\uFEFF# Hello\r\n\nworld 😀');
  assert.equal(makeRow('bad.md', Buffer.from([0xff])).reason, 'invalid_utf8');
  assert.equal(makeRow('nul.md', Buffer.from('a\0b')).reason, 'nul');
  const text = '😀abc\n'.repeat(15000);
  const parts = chunks(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(s => Buffer.byteLength(s) <= 12288));
  assert.ok(!sqlText("'; DROP TABLE x; --").includes('DROP'));
  assert.equal(manifestDigest([a]), manifestDigest([a]));
});

test('NUL UTF8 has derived searchable text while exact bytes stay authoritative', async () => {
  const { makeRow, metadata } = await import('./core.mjs');
  for (const original of ['# Alpha\n\nrareterm\0 evidence 😀\0', '\0', '\uFEFFa\0b\r\n']) {
    const bytes = Buffer.from(original), row = makeRow('nul.md', bytes);
    assert.equal(row.searchable, true);
    assert.equal(row.text, null);
    assert.equal(row.reason, 'nul');
    assert.equal(row.search_text, original.replaceAll('\0', ''));
    assert.equal(row.chunks.join(''), row.search_text);
    assert.deepEqual(Buffer.from(row.raw, 'base64'), bytes);
    assert.equal('search_text' in metadata(row), false);
  }
  const valid = makeRow('valid.md', Buffer.from('\uFEFFunchanged 😀\r\n'));
  assert.equal(valid.search_text, valid.text);
  const invalid = makeRow('invalid.md', Buffer.from([0xff, 0]));
  assert.equal(invalid.searchable, false);
  assert.equal(invalid.search_text, null);
  assert.equal(invalid.text, null);
  assert.equal(invalid.reason, 'invalid_utf8');
  assert.deepEqual(invalid.chunks, []);
});
