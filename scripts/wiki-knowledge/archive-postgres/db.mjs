import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { sqlText } from './core.mjs';
export async function psql(container, sql, rows = null, tail = '') {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Invalid container name');
  const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'cabinet_wiki'], { stdio: ['pipe','pipe','pipe'] });
  let out = '', error = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', s => { out += s; });
  child.stderr.on('data', s => { error = (error + s).slice(-32000); });
  // Install completion/error listeners before streaming to avoid missed exits.
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`psql exited ${code}: ${error}`)));
  });
  done.catch(() => {});
  child.stdin.on('error', () => {});
  const write = async s => {
    if (child.stdin.destroyed) { await done; throw new Error('psql input closed'); }
    if (!child.stdin.write(s)) await Promise.race([once(child.stdin, 'drain'), done.then(() => { throw new Error('psql stopped during input'); })]);
  };
  try {
    await write(sql + '\n');
    if (rows) {
      for await (const row of rows) await write(Buffer.from(JSON.stringify(row)).toString('base64') + '\n');
      await write('\\.\n' + tail + '\n');
    }
    child.stdin.end(); await done;
  } catch (e) { child.kill(); await done.catch(() => {}); throw e; }
  return out.trim();
}
export const query = async (container, sql) => JSON.parse(await psql(container, sql));
export const staging = 'CREATE TEMP TABLE stage (encoded text); COPY stage FROM STDIN;';
export const decodedStage = "SELECT convert_from(decode(encoded,'base64'),'UTF8')::jsonb AS j FROM stage";
export async function importBatch(container, generation, rows) {
  const gen = `${sqlText(generation)}::uuid`;
  await psql(container, `BEGIN; ${staging}`, rows, `
CREATE TEMP TABLE incoming AS ${decodedStage};
INSERT INTO cabinet_wiki_v1.documents(id,path,category)
 SELECT (j->>'id')::uuid,j->>'path',j->>'category' FROM incoming ON CONFLICT DO NOTHING;
INSERT INTO cabinet_wiki_v1.revisions(document_id,sha256,raw_bytes,raw_markdown,search_text,searchable,reason)
 SELECT (j->>'id')::uuid,j->>'sha256',decode(j->>'raw','base64'),j->>'text',j->>'search_text',(j->>'searchable')::boolean,j->>'reason'
 FROM incoming ON CONFLICT DO NOTHING;
-- Rebuild only derived chunks, atomically. This also reconciles legacy migration
-- chunk boundaries with the importer without changing any original revision bytes.
DELETE FROM cabinet_wiki_v1.chunks c USING incoming i
 WHERE c.document_id=(i.j->>'id')::uuid AND c.sha256=i.j->>'sha256';
INSERT INTO cabinet_wiki_v1.chunks(document_id,sha256,ordinal,body)
 SELECT (j->>'id')::uuid,j->>'sha256',c.ordinality::integer,c.value
 FROM incoming CROSS JOIN LATERAL jsonb_array_elements_text(j->'chunks') WITH ORDINALITY AS c(value,ordinality)
 ON CONFLICT DO NOTHING;
INSERT INTO cabinet_wiki_v1.members(import_id,document_id,sha256)
 SELECT ${gen},(j->>'id')::uuid,j->>'sha256' FROM incoming;
COMMIT;`);
}
