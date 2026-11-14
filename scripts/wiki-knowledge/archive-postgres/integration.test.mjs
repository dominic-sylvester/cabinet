import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

test('real PostgreSQL snapshots, bytes, large chunks, query safety and revisions', { skip: !process.env.WIKI_KNOWLEDGE_TEST_CONTAINER }, async () => {
  const container = process.env.WIKI_KNOWLEDGE_TEST_CONTAINER;
  assert.match(container, /test/);
  assert.notEqual(container, 'cabinet-wiki');
  const dir = await mkdtemp(join(join(homedir(), '.hermes/cache/scratch'), 'wiki-test-'));
  const root = join(dir, 'raw'); await mkdir(join(root, 'letters'), { recursive: true });
  const manifest = join(dir, 'manifest.json');
  const large = '# Big\n\n' + 'elephant compounding durable evidence.\n\n'.repeat(40000) + 'filler '.repeat(1600) + 'tailneedle';
  await writeFile(join(root, 'letters', "quote'file.md"), '\uFEFF# Alpha\r\n\nrareterm original 😀');
  await writeFile(join(root, 'letters', 'big.md'), large);
  await writeFile(join(root, 'bad.md'), Buffer.from([0xff, 0, 12]));
  await mkdir(join(root, '.hidden'));
  const nulBytes = Buffer.from('\uFEFF# Nul\r\n\nnulneedle\0 evidence 😀\0');
  await writeFile(join(root, '.hidden', 'nul.md'), nulBytes);
  const run = (...args) => JSON.parse(execFileSync(process.execPath, ['scripts/wiki-knowledge/cli.mjs', ...args, '--container', container], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  assert.equal(run('import', '--root', root, '--manifest', manifest, '--batch-size', '2').files, 4);
  const first = JSON.parse(await readFile(manifest));
  assert.equal(run('verify', '--manifest', manifest).verified, 4);
  const search = run('search', 'elephant', '--limit', '1');
  assert.equal(search.total, 1); assert.equal(search.results.length, 1);
  assert.ok(search.results[0].excerpt.length <= 1600);
  assert.doesNotMatch(search.results[0].excerpt, /,StopSel=|<\/?b>/);
  assert.match(run('search', 'tailneedle').results[0].excerpt, /tailneedle/);
  assert.equal(run('read', "letters/quote'file.md", '--section', 'Alpha', '--limit', '10').text, '\uFEFF# Alpha\r\n'.slice(0,10));
  assert.equal(run('read', "letters/quote'file.md", '--full').text, '\uFEFF# Alpha\r\n\nrareterm original 😀');
  assert.equal(run('read', 'letters/big.md', '--full').text, large);
  assert.equal(run('read', 'bad.md', '--full').raw_base64, Buffer.from([0xff, 0, 12]).toString('base64'));
  assert.equal(run('search', "'); DROP TABLE x; --").total, 0);
  assert.equal(run('list', '--limit', '1').total, 4);
  const nulRead = run('read', '.hidden/nul.md', '--full');
  assert.equal(nulRead.text, nulBytes.toString().replaceAll('\0', ''));
  assert.equal(nulRead.derived, true);
  assert.equal(nulRead.reason, 'nul');
  assert.equal(nulRead.text_method, 'nul_removed');
  assert.equal(nulRead.raw_base64, nulBytes.toString('base64'));
  assert.equal(run('read', '.hidden/nul.md', '--limit', '4').text, nulRead.text.slice(0, 4));
  assert.equal(run('read', '.hidden/nul.md', '--section', 'Nul', '--full').derived, true);
  assert.equal(run('read', 'bad.md', '--full').text, null);
  assert.equal(run('read', 'letters/big.md', '--full').derived, false);
  assert.equal(run('search', 'nulneedle').total, 1);
  assert.equal(first.files.filter(f => f.searchable).length, 3);
  assert.equal(first.files.filter(f => f.reason === 'nul').length, 1);
  assert.equal(first.bytes, first.files.reduce((sum, f) => sum + f.bytes, 0));
  const stats1 = run('stats');
  assert.equal(stats1.searchable, 3);
  const nulRevision = first.files.find(f => f.reason === 'nul');
  const { psql } = await import('./db.mjs');
  await psql(container, `DELETE FROM cabinet_wiki_v1.chunks WHERE document_id='${nulRevision.id}' AND sha256='${nulRevision.sha256}';`);
  assert.throws(() => run('verify', '--manifest', manifest));
  run('import', '--root', root, '--manifest', manifest);
  assert.equal(run('verify', '--manifest', manifest).verified, 4);
  assert.equal(run('stats').revisions, stats1.revisions);
  await writeFile(join(root, 'letters', "quote'file.md"), `rareterm changed ${dir}`);
  run('import', '--root', root, '--manifest', manifest);
  assert.equal(run('stats').revisions, stats1.revisions + 1);
  const old = first.files.find(r => r.path.includes('quote'));
  assert.equal(run('read', old.id, '--revision', old.sha256, '--full').text, '\uFEFF# Alpha\r\n\nrareterm original 😀');
  assert.equal(run('verify', '--manifest', manifest).verified, 4);
  assert.equal(run('verify', '--manifest', join(dir, 'manifest.json')).ok, true);
  await writeFile(join(root, '.hidden', 'nul.md'), `replacement NUL-free revision ${dir}`);
  run('import', '--root', root, '--manifest', manifest);
  assert.equal(run('stats').revisions, stats1.revisions + 2);
  assert.equal(run('search', 'nulneedle').total, 0);
  const historicalNul = run('read', nulRevision.id, '--revision', nulRevision.sha256, '--full');
  assert.equal(historicalNul.derived, true);
  assert.equal(historicalNul.text, nulRead.text);
  assert.equal(historicalNul.raw_base64, nulBytes.toString('base64'));
  await writeFile(join(dir, 'first-manifest.json'), JSON.stringify(first));
  assert.equal(run('verify', '--manifest', join(dir, 'first-manifest.json')).verified, 4);
  const corrupt = JSON.parse(await readFile(manifest)); corrupt.files[0].sha256 = '0'.repeat(64);
  await writeFile(join(dir, 'bad-manifest.json'), JSON.stringify(corrupt));
  assert.throws(() => run('verify', '--manifest', join(dir, 'bad-manifest.json')));
});

test('failed batch never publishes; verification detects lost chunks and DB byte changes', {skip:!process.env.WIKI_KNOWLEDGE_TEST_CONTAINER}, async()=>{
  const c=process.env.WIKI_KNOWLEDGE_TEST_CONTAINER;
  assert.match(c,/test/); assert.notEqual(c,'cabinet-wiki');
  const { psql, query } = await import('./db.mjs');
  const dir=await mkdtemp(join(homedir(),'.hermes/cache/scratch/wiki-fail-'));
  const root=join(dir,'raw'),manifest=join(dir,'manifest.json'); await mkdir(root);
  const run=(...args)=>JSON.parse(execFileSync(process.execPath,['scripts/wiki-knowledge/cli.mjs',...args,'--container',c],{encoding:'utf8',stdio:['pipe','pipe','pipe']}));
  await writeFile(join(root,'000base.md'),'# Base\n\nunchanged evidence');
  run('import','--root',root,'--manifest',manifest,'--batch-size','1');
  const original=JSON.parse(await readFile(manifest));
  await writeFile(join(root,'zzz-fail.md'),'new document never published');
  await psql(c,`CREATE OR REPLACE FUNCTION cabinet_wiki_v1.test_reject() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN IF NEW.path='zzz-fail.md' THEN RAISE EXCEPTION 'injected file failure'; END IF; RETURN NEW; END $fn$;
CREATE TRIGGER test_reject BEFORE INSERT ON cabinet_wiki_v1.documents FOR EACH ROW EXECUTE FUNCTION cabinet_wiki_v1.test_reject();`);
  try {
    assert.throws(()=>run('import','--root',root,'--manifest',manifest,'--batch-size','1'));
    assert.equal(run('stats').active_import,original.import_id);
    assert.equal(JSON.parse(await readFile(manifest)).import_id,original.import_id);
    const journal=(await readFile(manifest+'.journal.jsonl','utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(journal.at(-1).event,'error'); assert.equal(journal.at(-1).path,'zzz-fail.md');
    assert.equal(run('verify','--manifest',manifest).ok,true);
  } finally { await psql(c,'DROP TRIGGER test_reject ON cabinet_wiki_v1.documents; DROP FUNCTION cabinet_wiki_v1.test_reject();'); }
  const id=original.files[0].id, hash=original.files[0].sha256;
  // Hold corruption inside a rollback transaction; verify from this same connection.
  const result=await query(c,`BEGIN; DELETE FROM cabinet_wiki_v1.chunks WHERE document_id='${id}' AND sha256='${hash}';
SELECT to_json((SELECT count(*)=0 FROM cabinet_wiki_v1.chunks WHERE document_id='${id}')); ROLLBACK;`);
  assert.equal(result,true);
  // Actual persistent test-only corruption is repaired by an idempotent re-import.
  await psql(c,`DELETE FROM cabinet_wiki_v1.chunks WHERE document_id='${id}' AND sha256='${hash}';`);
  assert.throws(()=>run('verify','--manifest',manifest));
  run('import','--root',root,'--manifest',manifest);
  assert.equal(run('verify','--manifest',manifest).ok,true);
  assert.throws(()=>execFileSync('docker',['exec','-i',c,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','cabinet_wiki'],{input:`UPDATE cabinet_wiki_v1.revisions SET raw_bytes=decode('00','hex') WHERE document_id='${id}';`,stdio:['pipe','pipe','pipe']}));
});


test('additive v1 upgrade preserves legacy NUL bytes and reconstructs derived chunks', {skip:!process.env.WIKI_KNOWLEDGE_TEST_CONTAINER}, async()=>{
  const c=process.env.WIKI_KNOWLEDGE_TEST_CONTAINER;
  assert.equal(c,'cabinet-wiki-integration-test');
  const { query } = await import('./db.mjs');
  const { makeRow, sqlText } = await import('./core.mjs');
  const original='\uFEFF# Legacy\r\n\n'+('a😀'+String.raw`\000`+'\0tail ').repeat(2000)+'\0';
  const row=makeRow('migration-legacy-nul.md',Buffer.from(original));
  const schema=(await readFile(new URL('./schema.sql',import.meta.url),'utf8')).replace(/^BEGIN;\n/,'').replace(/COMMIT;\s*$/,'');
  // Emulate old byte-only representation in a rollback-only transaction. No
  // source/root import, schema reset, or permanent fixture revision is needed.
  const result=await query(c,`BEGIN;
ALTER TABLE cabinet_wiki_v1.revisions DROP CONSTRAINT revisions_text_representation;
INSERT INTO cabinet_wiki_v1.documents(id,path,category) VALUES ('${row.id}',${sqlText(row.path)},'(root)');
INSERT INTO cabinet_wiki_v1.revisions(document_id,sha256,raw_bytes,raw_markdown,searchable,reason)
 VALUES ('${row.id}','${row.sha256}',decode('${row.raw}','base64'),NULL,false,'nul');
${schema}
SELECT json_build_object('raw',replace(encode(r.raw_bytes,'base64'),E'\n',''),
 'sha256',r.sha256,'text',r.search_text,'raw_markdown',r.raw_markdown,'searchable',r.searchable,'reason',r.reason,
 'chunks',(SELECT string_agg(c.body,'' ORDER BY c.ordinal) FROM cabinet_wiki_v1.chunks c WHERE c.document_id=r.document_id AND c.sha256=r.sha256),
 'bounded',(SELECT bool_and(octet_length(c.body)<=12288) FROM cabinet_wiki_v1.chunks c WHERE c.document_id=r.document_id AND c.sha256=r.sha256))
 FROM cabinet_wiki_v1.revisions r WHERE r.document_id='${row.id}' AND r.sha256='${row.sha256}';
ROLLBACK;`);
  assert.equal(result.raw,row.raw);
  assert.equal(result.sha256,row.sha256);
  assert.equal(result.text,original.replaceAll('\0',''));
  assert.equal(result.raw_markdown,null);
  assert.equal(result.searchable,true);
  assert.equal(result.reason,'nul');
  assert.equal(result.chunks,result.text);
  assert.equal(result.bounded,true);
  assert.equal(await query(c,`SELECT to_json(count(*)) FROM cabinet_wiki_v1.documents WHERE id='${row.id}';`),0);
});
