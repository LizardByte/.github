import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
