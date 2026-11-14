import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('CLI help and strict argument validation need no database', () => {
  const run = (...args) => execFileSync(process.execPath,['scripts/wiki-knowledge/cli.mjs',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']});
  assert.match(run('--help'), /--section/);
  assert.throws(()=>run('list','--limit','-1'));
  assert.throws(()=>run('read','a','--revision','not-a-hash'));
  assert.throws(()=>run('unknown'));
});

