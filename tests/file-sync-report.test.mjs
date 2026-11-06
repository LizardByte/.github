import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {writeSyncReport} from '../.github/scripts/file-sync-report.mjs';

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
  const report = await writeSyncReport({
    core: {summary: output}, context: {sha: 'revision', ref: 'refs/pull/1/merge'}, outputDirectory: directory,
    env: {SYNC_DRY_RUN: 'true', SYNC_RESULTS: JSON.stringify(results), SYNC_OUTCOME: 'failure',
      SYNC_CHANGED: '1', SYNC_FAILED: '1', SYNC_ORGANIZATION: 'example', SYNC_REPOSITORY: 'example/app'},
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
  assert.ok(output.calls.some(([type, value]) => type === 'raw' && value.includes('Dry run only')));
  assert.ok(output.calls.some(([type, value]) => type === 'heading' && value === 'File sync preview'));
  assert.deepEqual(output.calls.at(-1), ['write']);
});

test('an action failure without outputs still produces a delivery diagnostic report', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-sync-report-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const output = summary();
  const report = await writeSyncReport({
    core: {summary: output}, context: {sha: 'revision', ref: 'refs/heads/master'},
    env: {SYNC_DRY_RUN: 'false', SYNC_OUTCOME: 'failure'}, outputDirectory: directory,
  });
  assert.deepEqual(report.results, []);
  assert.equal(report.changed_repositories, 0);
  assert.equal(report.failed_repositories, 0);
  assert.equal(report.organization, null);
  assert.equal(report.repository, null);
  assert.ok(output.calls.some(([type, value]) => type === 'raw' && value.includes('**failure**')));
  assert.equal(JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8')).dry_run, false);
});

test('delivery reports retain target PR URLs and never claim to be read-only', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'file-sync-report-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const output = summary();
  const results = [{repository: 'example/app', status: 'updated',
    pull_request: 'https://github.com/example/app/pull/42', changes: [{path: 'shared.yml', operation: 'update'}]}];
  const report = await writeSyncReport({
    core: {summary: output}, context: {sha: 'revision', ref: 'refs/heads/master'}, outputDirectory: directory,
    env: {SYNC_DRY_RUN: 'false', SYNC_RESULTS: JSON.stringify(results), SYNC_OUTCOME: 'success', SYNC_CHANGED: '1'},
  });
  assert.equal(report.dry_run, false);
  assert.equal(report.changed_repositories, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8')).results, results);
  assert.ok(output.calls.some(([type, value]) => type === 'heading' && value === 'File synchronization'));
  const prose = output.calls.filter(([type]) => type === 'raw').map(([, value]) => value).join('');
  assert.match(prose, /Delivery enabled/);
  assert.doesNotMatch(prose, /Dry run only|No target/);
});

test('malformed action output is rejected before writing a misleading summary', async () => {
  const output = summary();
  await assert.rejects(writeSyncReport({core: {summary: output}, context: {},
    env: {SYNC_DRY_RUN: 'true', SYNC_RESULTS: '{}'}}),
    /Expected an array of file sync results/);
  assert.deepEqual(output.calls, []);
});

test('missing or invalid mode cannot produce a misleading read-only report', async () => {
  for (const mode of [undefined, '', 'FALSE', '0']) {
    const output = summary();
    await assert.rejects(writeSyncReport({core: {summary: output}, context: {}, env: {SYNC_DRY_RUN: mode}}),
      /Expected an explicit file sync dry-run mode/);
    assert.deepEqual(output.calls, []);
  }
});
