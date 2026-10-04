import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';

import {
  cleanupCloudsmith,
  hasCloudsmithTag,
  packageMatchesRelease,
  planCloudsmithCleanup,
  publishedReleaseTags,
  releaseVersion,
} from '../.github/scripts/cleanup-cloudsmith.mjs';

test('releaseVersion removes only a numeric v prefix', () => {
  assert.equal(releaseVersion('v2026.906.123708'), '2026.906.123708');
  assert.equal(releaseVersion('0.5.0'), '0.5.0');
  assert.equal(releaseVersion('version-one'), 'version-one');
});

test('packageMatchesRelease supports exact and native package release suffixes', () => {
  const tags = new Set(['v2026.516.143833', 'v0.23.1']);
  assert.equal(packageMatchesRelease('2026.516.143833-1+ubuntu24.04', tags), true);
  assert.equal(packageMatchesRelease('2026.516.143833-1.fc44', tags), true);
  assert.equal(packageMatchesRelease('0.23.1', tags), true);
  assert.equal(packageMatchesRelease('0.23.10-1.fc44', tags), false);
  assert.equal(packageMatchesRelease('2026.906.123708-1.fc44', tags), false);
});

test('hasCloudsmithTag finds automatic tags in any tag group', () => {
  assert.equal(hasCloudsmithTag({tags: {version: ['latest']}}, 'latest'), true);
  assert.equal(hasCloudsmithTag({tags: {custom: ['latest']}}, 'latest'), true);
  assert.equal(hasCloudsmithTag({tags: {}}, 'latest'), false);
});

test('publishedReleaseTags keeps stable and prereleases but excludes drafts', () => {
  const tags = publishedReleaseTags([
    {tag_name: 'v1.0.0', draft: false, prerelease: false},
    {tag_name: 'v1.1.0-beta', draft: false, prerelease: true},
    {tag_name: 'v2.0.0', draft: true, prerelease: false},
  ]);
  assert.deepEqual([...tags], ['v1.0.0', 'v1.1.0-beta']);
});

test('planCloudsmithCleanup retains releases, latest targets, recent and unknown packages', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  const packageData = (overrides) => ({
    name: 'sunshine',
    version: '2026.900.000000-1.fc44',
    uploaded_at: '2026-09-01T00:00:00Z',
    identifier_perm: 'package',
    tags: {},
    ...overrides,
  });
  const packages = [
    packageData({identifier_perm: 'release', version: '2026.516.143833-1.fc44'}),
    packageData({identifier_perm: 'latest', tags: {version: ['latest']}}),
    packageData({identifier_perm: 'recent', uploaded_at: '2026-09-06T11:00:00Z'}),
    packageData({identifier_perm: 'unknown', name: 'future-package'}),
    packageData({identifier_perm: 'stale'}),
  ];
  const plan = planCloudsmithCleanup({
    packages,
    repositories: [{name: 'Sunshine'}],
    releaseTagsByRepository: new Map([
      ['sunshine', new Set(['v2026.516.143833'])],
    ]),
    now,
  });

  assert.deepEqual(plan.keep.map(({package: item}) => item.identifier_perm), [
    'release', 'latest', 'recent', 'unknown',
  ]);
  assert.deepEqual(plan.remove.map(({package: item}) => item.identifier_perm), ['stale']);
});

test('Cloudsmith cleanup collects all pages and processes releases and deletions sequentially', async (t) => {
  const pages = [];
  const deletions = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (options.method === 'DELETE') {
      const identifier = new URL(input).pathname.split('/').at(-2);
      deletions.push(`start ${identifier}`);
      await setImmediate();
      deletions.push(`end ${identifier}`);
      return new Response(null, {status: 204});
    }
    const page = Number(new URL(input).searchParams.get('page'));
    pages.push(page);
    const packages = page === 1 ? Array.from({length: 100}, (_, index) => ({
      name: 'sunshine', version: '1.0.0', identifier_perm: `release-${index}`,
    })) : [
      {name: 'beta', version: 'old-build', identifier_perm: 'stale-1'},
      {name: 'beta', version: 'old-build', identifier_perm: 'stale-2'},
    ];
    return Response.json(packages, {headers: {'x-pagination-pagetotal': '2'}});
  });
  const events = [];
  const github = {
    rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
    async paginate(route, options) {
      if (route === 'repos') {
        return [{name: 'Sunshine'}, {name: 'Beta'}];
      }
      events.push(`start ${options.repo}`);
      await setImmediate();
      events.push(`end ${options.repo}`);
      return [{tag_name: 'v1.0.0', draft: false}];
    },
  };
  const summary = {
    addHeading() { return this; },
    addTable() { return this; },
    async write() {},
  };
  const result = await cleanupCloudsmith({
    github, core: {info() {}, warning() {}, summary}, token: 'token', dryRun: false,
  });
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(events, ['start Sunshine', 'end Sunshine', 'start Beta', 'end Beta']);
  assert.deepEqual(deletions, ['start stale-1', 'end stale-1', 'start stale-2', 'end stale-2']);
  assert.deepEqual(result, {scanned: 102, retained: 100, selected: 2});
});

test('Cloudsmith cleanup stops before deletion if loading release tags fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.notEqual(options.method, 'DELETE');
    return Response.json([
      {name: 'alpha', version: 'old', identifier_perm: 'alpha'},
      {name: 'beta', version: 'old', identifier_perm: 'beta'},
    ]);
  });
  const releases = [];
  const failure = new Error('GitHub unavailable');
  const github = {
    rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
    async paginate(route, options) {
      if (route === 'repos') {
        return [{name: 'Alpha'}, {name: 'Beta'}];
      }
      releases.push(options.repo);
      throw failure;
    },
  };
  await assert.rejects(cleanupCloudsmith({github, core: {}, token: 'token', dryRun: false}), failure);
  assert.deepEqual(releases, ['Alpha']);
});
