import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {writePreviewReport} from '../.github/scripts/file-sync-preview.mjs';

function summary() {
  const calls = [];
  return {
    calls,
    addHeading: value => calls.push(['heading', value]),
    addRaw: value => calls.push(['raw', value]),
    addTable: value => calls.push(['table', value]),
    write: async () => calls.push(['write']),
  };
}

test('partial discovery failures retain exact changes and errors in the read-only artifact', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-sync-report-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const output = summary();
  const results = [
    {repository: 'example/app', status: 'planned', changes: [{path: 'old.yml', operation: 'remove'}], warnings: []},
    {repository: 'other/*', status: 'failed', error: 'Property access denied'},
    {repository: 'example/mirror', status: 'excluded'},
  ];
  const report = await writePreviewReport({
    core: {summary: output}, context: {sha: 'revision', ref: 'refs/pull/1/merge'}, outputDirectory: directory,
    env: {PREVIEW_RESULTS: JSON.stringify(results), PREVIEW_OUTCOME: 'failure', PREVIEW_CHANGED: '1', PREVIEW_FAILED: '1',
      PREVIEW_ORGANIZATION: 'example', PREVIEW_REPOSITORY: 'example/app'},
  });
  assert.equal(report.dry_run, true);
  assert.equal(report.outcome, 'failure');
  assert.equal(report.source_commit, 'revision');
  assert.equal(report.source_ref, 'refs/pull/1/merge');
  assert.equal(report.organization, 'example');
  assert.equal(report.repository, 'example/app');
  assert.equal(report.changed_repositories, 1);
  assert.equal(report.failed_repositories, 1);
  assert.deepEqual(report.results, results);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8')), report);
  assert.deepEqual(output.calls.find(([type]) => type === 'table')[1].slice(1), [
    ['example/app', 'planned', '1'], ['other/*', 'failed', '0'], ['example/mirror', 'excluded', '0'],
  ]);
  assert.ok(output.calls.some(([type, value]) => type === 'raw' && value.includes('global replicator remains active')));
  assert.deepEqual(output.calls.at(-1), ['write']);
});

test('an action failure without outputs still produces a diagnostic report', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-sync-report-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const output = summary();
  const report = await writePreviewReport({
    core: {summary: output}, context: {sha: 'revision', ref: 'refs/heads/master'},
    env: {PREVIEW_OUTCOME: 'failure'}, outputDirectory: directory,
  });
  assert.deepEqual(report.results, []);
  assert.equal(report.changed_repositories, 0);
  assert.equal(report.failed_repositories, 0);
  assert.equal(report.organization, null);
  assert.equal(report.repository, null);
  assert.ok(output.calls.some(([type, value]) => type === 'raw' && value.includes('**failure**')));
  assert.equal(JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8')).dry_run, true);
});

test('malformed action output is rejected before writing a misleading summary', async () => {
  const output = summary();
  await assert.rejects(writePreviewReport({core: {summary: output}, context: {}, env: {PREVIEW_RESULTS: '{}'}}),
    /Expected an array of file sync results/);
  assert.deepEqual(output.calls, []);
});
