#!/usr/bin/env node
import { readdir, readFile, stat, mkdir, open, rename } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { makeRow, metadata, manifestDigest, VERSION, sqlText, sqlJson, positive } from './core.mjs';
import { psql, query, importBatch, staging, decodedStage } from './db.mjs';
const HELP = `Local operator raw wiki CLI (not a production MCP or room-authorized API)
Usage: node scripts/wiki-knowledge/cli.mjs COMMAND [ARG] [OPTIONS]
  import --root ROOT --manifest PATH [--batch-size 20]
  verify --manifest PATH
  stats
  list [--limit 50] [--offset 0] [--category NAME]
  search QUERY [--limit 20] [--offset 0] [--category NAME]
  read ID_OR_PATH [--revision SHA256] [--offset 0] [--limit 12000]
       [--section HEADING] [--full]
Global: --container NAME (default cabinet-wiki), --help
Outputs JSON. read returns Unicode-character pagination; --full explicitly returns
all display text plus exact base64 original bytes for invalid UTF8/NUL sources.
NUL display/search text removes NUL; read labels it derived. Revision is SHA256.
Import writes PATH plus PATH.journal.jsonl; never writes the source corpus.
`;
const options = { root: {type:'string'}, manifest:{type:'string'}, container:{type:'string'}, 'batch-size':{type:'string'}, limit:{type:'string'}, offset:{type:'string'}, category:{type:'string'}, revision:{type:'string'}, section:{type:'string'}, full:{type:'boolean'}, help:{type:'boolean'} };
async function inventory(root, dir = root) {
  const result = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`);
    if (ent.isDirectory()) result.push(...await inventory(root, path));
    else if (ent.isFile() && ent.name.endsWith('.md')) {
      const s = await stat(path);
      result.push({path: relative(root,path).split('\\').join('/'), size:s.size, mtime:s.mtimeMs});
    }
  }
  return result.sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
async function durableJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const f = await open(temp, 'wx', 0o600);
  try { await f.writeFile(JSON.stringify(value,null,2) + '\n'); await f.sync(); } finally { await f.close(); }
  await rename(temp,path);
  const dir = await open(dirname(path),'r'); try { await dir.sync(); } finally { await dir.close(); }
}
async function journal(path, event) {
  const f = await open(path,'a',0o600);
  try { await f.writeFile(JSON.stringify(event)+'\n'); await f.sync(); } finally { await f.close(); }
}
async function verifyManifest(container, m) {
  if (m.version !== VERSION || m.status !== 'complete' || !Array.isArray(m.files)) throw new Error('Not a completed v1 manifest');
  if (m.checksum !== manifestDigest(m.files)) throw new Error('Manifest checksum mismatch');
  if (new Set(m.files.map(f=>f.id)).size !== m.files.length || m.count !== m.files.length || m.bytes !== m.files.reduce((s,f)=>s+f.bytes,0)) throw new Error('Manifest totals/identity mismatch');
  const gen = `${sqlText(m.import_id)}::uuid`;
  const output = await psql(container, `BEGIN; ${staging}`, m.files, `
CREATE TEMP TABLE expected AS ${decodedStage};
WITH failures AS (
 SELECT e.j->>'path' AS path FROM expected e
 LEFT JOIN cabinet_wiki_v1.members x ON x.import_id=${gen} AND x.document_id=(e.j->>'id')::uuid
 LEFT JOIN cabinet_wiki_v1.documents d ON d.id=x.document_id
 LEFT JOIN cabinet_wiki_v1.revisions r ON r.document_id=x.document_id AND r.sha256=x.sha256
 WHERE r.sha256 IS NULL OR r.sha256<>e.j->>'sha256' OR d.path<>e.j->>'path' OR d.category<>e.j->>'category'
 OR octet_length(r.raw_bytes)<>(e.j->>'bytes')::bigint
 OR encode(digest(r.raw_bytes,'sha256'),'hex')<>e.j->>'sha256'
 OR r.searchable<>(e.j->>'searchable')::boolean OR r.reason IS DISTINCT FROM e.j->>'reason'
 OR (r.raw_markdown IS NOT NULL AND convert_to(r.raw_markdown,'UTF8')<>r.raw_bytes)
 OR (r.searchable AND r.search_text IS DISTINCT FROM
   coalesce((SELECT string_agg(c.body,'' ORDER BY c.ordinal) FROM cabinet_wiki_v1.chunks c WHERE c.document_id=r.document_id AND c.sha256=r.sha256),''))
 OR (r.reason='nul' AND (r.raw_markdown IS NOT NULL OR r.search_text IS DISTINCT FROM cabinet_wiki_v1.nul_removed_utf8(r.raw_bytes)))
 OR (r.reason IS NULL AND r.search_text IS DISTINCT FROM r.raw_markdown)
 OR (NOT r.searchable AND (r.search_text IS NOT NULL OR r.raw_markdown IS NOT NULL OR EXISTS
   (SELECT 1 FROM cabinet_wiki_v1.chunks c WHERE c.document_id=r.document_id AND c.sha256=r.sha256)))
)
SELECT json_build_object('verified',(SELECT count(*) FROM expected),'failures',coalesce((SELECT json_agg(path) FROM failures),'[]'::json),
 'members',(SELECT count(*) FROM cabinet_wiki_v1.members WHERE import_id=${gen}),
 'stored_checksum',(SELECT manifest->>'checksum' FROM cabinet_wiki_v1.imports WHERE id=${gen}));
COMMIT;`);
  const result = JSON.parse(output);
  if (result.failures.length || result.members !== m.count || result.stored_checksum !== m.checksum) throw new Error(`Database verification failed: ${JSON.stringify(result)}`);
  return {ok:true, import_id:m.import_id, verified:result.verified, bytes:m.bytes, checksum:m.checksum};
}
async function ingest(container, v) {
  if (!v.root || !v.manifest) throw new Error('import requires --root and --manifest');
  const root = resolve(v.root), target = resolve(v.manifest), log = target+'.journal.jsonl';
  if (target === root || target.startsWith(root+'/')) throw new Error('Manifest must be outside source root');
  const batchSize = positive(v['batch-size'],20,1000); if (!batchSize) throw new Error('batch-size must be positive');
  await mkdir(dirname(target), {recursive:true});
  const id = randomUUID(), files = [], initial = await inventory(root);
  if (!initial.length) throw new Error('No .md files found; refusing empty publication');
  await journal(log,{event:'start', import_id:id, root, count:initial.length, at:new Date().toISOString()});
  await psql(container, await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  await psql(container, `INSERT INTO cabinet_wiki_v1.imports(id,status) VALUES (${sqlText(id)}::uuid,'loading');`);
  let batch = [], batchBytes = 0, current = null;
  const flush = async () => {
    if (!batch.length) return;
    await importBatch(container,id,batch);
    await journal(log,{event:'batch',import_id:id,files:batch.map(metadata)});
    files.push(...batch.map(metadata)); batch=[]; batchBytes=0;
    process.stderr.write(`import ${id}: ${files.length}/${initial.length}\n`);
  };
  try {
    for (const entry of initial) {
      current = entry.path;
      const path = join(root,entry.path), bytes = await readFile(path), after = await stat(path);
      if (after.size!==entry.size || after.mtimeMs!==entry.mtime || bytes.length!==entry.size) throw new Error('Source changed during import');
      const row = makeRow(entry.path,bytes); batch.push(row); batchBytes += bytes.length;
      if (batch.length>=batchSize || batchBytes>=16*1024*1024) await flush();
    }
    await flush();
    if (JSON.stringify(initial)!==JSON.stringify(await inventory(root))) throw new Error('Source inventory changed during import');
    const m = {version:VERSION,status:'complete',import_id:id,root,created_at:new Date().toISOString(),count:files.length,bytes:files.reduce((s,f)=>s+f.bytes,0),checksum:manifestDigest(files),files};
    // Persist DB manifest first, verify bytes before publishing the generation.
    await psql(container, `UPDATE cabinet_wiki_v1.imports SET manifest=${sqlJson(m)} WHERE id=${sqlText(id)}::uuid;`);
    await verifyManifest(container,m);
    // Durable manifest exists before publication. A crash can leave it referencing an
    // unpublished but verifiable generation, never make partial members searchable.
    await durableJson(target,m);
    await psql(container, `BEGIN; UPDATE cabinet_wiki_v1.imports SET status='complete' WHERE id=${sqlText(id)}::uuid;
INSERT INTO cabinet_wiki_v1.active(singleton,import_id) VALUES(true,${sqlText(id)}::uuid)
ON CONFLICT(singleton) DO UPDATE SET import_id=excluded.import_id; COMMIT;`);
    const active = await query(container, 'SELECT to_json(import_id) FROM cabinet_wiki_v1.active;');
    if(active!==id) throw new Error('Concurrent publication superseded this import');
    await journal(log,{event:'complete',import_id:id,checksum:m.checksum});
    return {ok:true,import_id:id,files:files.length,bytes:m.bytes,checksum:m.checksum,manifest:target};
  } catch(e) {
    await journal(log,{event:'error',import_id:id,path:current,error:e.message,at:new Date().toISOString()}); throw e;
  }
}
async function main() {
  const {values:v,positionals:p} = parseArgs({options,allowPositionals:true});
  if (v.help || !p.length) { console.log(HELP); return; }
  const [cmd,arg] = p, c=v.container || 'cabinet-wiki';
  let result;
  const offset=positive(v.offset,0), limit=positive(v.limit,cmd==='search'?20:cmd==='read'?12000:50,cmd==='read'?1000000:1000);
  const category=v.category===undefined?'true':`d.category=${sqlText(v.category)}`;
  if(cmd==='import') result=await ingest(c,v);
  else if(cmd==='verify') { if(!v.manifest) throw new Error('verify requires --manifest'); result=await verifyManifest(c,JSON.parse(await readFile(resolve(v.manifest),'utf8'))); }
  else if(cmd==='stats') result=await query(c,`SELECT json_build_object('documents',(SELECT count(*) FROM cabinet_wiki_v1.current_documents),'bytes',(SELECT coalesce(sum(octet_length(raw_bytes)),0) FROM cabinet_wiki_v1.current_documents),'searchable',(SELECT count(*) FROM cabinet_wiki_v1.current_documents WHERE searchable),'revisions',(SELECT count(*) FROM cabinet_wiki_v1.revisions),'chunks',(SELECT count(*) FROM cabinet_wiki_v1.chunks),'active_import',(SELECT import_id FROM cabinet_wiki_v1.active),'categories',(SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT category,count(*) AS documents,sum(octet_length(raw_bytes)) AS bytes FROM cabinet_wiki_v1.current_documents GROUP BY category ORDER BY category) x));`);
  else if(cmd==='list') result=await query(c,`WITH eligible AS (SELECT d.id,d.path,d.category,d.sha256,d.searchable,d.reason,octet_length(d.raw_bytes) AS bytes FROM cabinet_wiki_v1.current_documents d WHERE ${category}), page AS (SELECT * FROM eligible ORDER BY path LIMIT ${limit} OFFSET ${offset}) SELECT json_build_object('total',(SELECT count(*) FROM eligible),'offset',${offset},'limit',${limit},'truncated',(SELECT count(*) FROM eligible)>${offset+limit},'results',coalesce((SELECT json_agg(page) FROM page),'[]'::json));`);
  else if(cmd==='search') {
    if(!arg) throw new Error('search requires QUERY');
    result=await query(c,`WITH q AS (SELECT websearch_to_tsquery('simple',${sqlText(arg)}) AS terms), hits AS (
 SELECT d.id,d.path,d.category,d.sha256,c.ordinal,ts_rank_cd(c.terms,q.terms) AS rank,
 row_number() OVER(PARTITION BY d.id ORDER BY ts_rank_cd(c.terms,q.terms) DESC,c.ordinal) AS n
 FROM cabinet_wiki_v1.chunks c JOIN cabinet_wiki_v1.current_documents d ON d.id=c.document_id AND d.sha256=c.sha256 CROSS JOIN q
 WHERE d.searchable AND ${category} AND c.terms @@ q.terms), eligible AS (SELECT id,path,category,sha256,ordinal,rank FROM hits WHERE n=1),
 page AS (SELECT * FROM eligible ORDER BY rank DESC,path LIMIT ${limit} OFFSET ${offset}),
 excerpts AS (SELECT page.*,left(ts_headline('simple',c.body,q.terms,'MaxWords=80,MinWords=20,MaxFragments=1,StartSel="[[",StopSel="]]"'),1600) AS excerpt
 FROM page JOIN cabinet_wiki_v1.chunks c ON c.document_id=page.id AND c.sha256=page.sha256 AND c.ordinal=page.ordinal CROSS JOIN q ORDER BY page.rank DESC,page.path)
 SELECT json_build_object('total',(SELECT count(*) FROM eligible),'offset',${offset},'limit',${limit},'truncated',(SELECT count(*) FROM eligible)>${offset+limit},'results',coalesce((SELECT json_agg(excerpts) FROM excerpts),'[]'::json));`);
  } else if(cmd==='read') {
    if(!arg) throw new Error('read requires ID_OR_PATH');
    const rev=v.revision;
    if(rev && !/^[0-9a-f]{64}$/.test(rev)) throw new Error('revision must be lowercase SHA256');
    const from=rev?`cabinet_wiki_v1.documents d JOIN cabinet_wiki_v1.revisions r ON r.document_id=d.id AND r.sha256=${sqlText(rev)}`:'cabinet_wiki_v1.current_documents d';
    const r=rev?'r':'d';
    // A section is bounded from an exact Markdown ATX heading to the next
    // heading of the same or higher level, applied before pagination.
    const body = `${r}.search_text`;
    result=await query(c,`SELECT json_build_object('id',d.id,'path',d.path,'revision',${r}.sha256,'searchable',${r}.searchable,'reason',${r}.reason,
 'derived',coalesce(${r}.reason='nul',false),'text_method',CASE WHEN ${r}.reason='nul' THEN 'nul_removed' WHEN ${r}.searchable THEN 'lossless_utf8' ELSE 'unavailable' END,
 'text',${v.full||v.section?body:`substring(${body} FROM ${offset+1} FOR ${limit})`},
 'total_characters',char_length(${body}),'offset',${offset},'limit',${limit},
 'truncated',${v.full?'false':`char_length(${body})>${offset+limit}`},
 'raw_base64',CASE WHEN ${r}.raw_markdown IS NULL AND ${v.full?'true':'false'} THEN replace(encode(${r}.raw_bytes,'base64'),E'\n','') ELSE NULL END)
 FROM ${from} WHERE (d.path=${sqlText(arg)} OR d.id::text=${sqlText(arg)});`);
    if(!result) throw new Error('Document/revision not found');
    if(v.section) {
      const lines=result.text?.split(/(?<=\n)/u) || []; let start=-1,end=lines.length,level=0;
      for(let i=0;i<lines.length;i++) { const match=/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*\r?\n?$/.exec(i===0?lines[i].replace(/^\uFEFF/,''):lines[i]);
        if(!match) continue;
        if(start<0 && match[2].trim()===v.section) {start=i;level=match[1].length;}
        else if(start>=0 && match[1].length<=level){end=i;break;}
      }
      if(start<0) throw new Error('Section not found (exact ATX heading text required)');
      const text=lines.slice(start,end).join(''), chars=Array.from(text);
      result={...result,section:v.section,total_characters:chars.length,text:v.full?text:chars.slice(offset,offset+limit).join(''),truncated:!v.full&&chars.length>offset+limit};
    }
  } else throw new Error(`Unknown command: ${cmd}`);
  console.log(JSON.stringify(result));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;});
