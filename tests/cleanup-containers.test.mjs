import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGhcrVersions,
  ghcrCleanupCandidates,
  isRetainedContainerTag,
  planDockerHubCleanup,
  publishedReleaseTags,
  resolveReachableDigests,
} from '../.github/scripts/cleanup-containers.mjs';

test('publishedReleaseTags includes stable and prerelease releases but not drafts', () => {
  assert.deepEqual(
    [...publishedReleaseTags([
      {tag_name: 'v1.0.0', draft: false, prerelease: false},
      {tag_name: 'v1.1.0', draft: false, prerelease: true},
      {tag_name: 'v2.0.0', draft: true, prerelease: false},
    ])],
    ['v1.0.0', 'v1.1.0'],
  );
});

test('isRetainedContainerTag supports release variants and moving aliases', () => {
  const releases = new Set(['v2026.516.143833']);
  assert.equal(isRetainedContainerTag('v2026.516.143833', releases), true);
  assert.equal(isRetainedContainerTag('v2026.516.143833-ubuntu-24.04', releases), true);
  assert.equal(isRetainedContainerTag('latest-clion-toolchain', releases), true);
  assert.equal(isRetainedContainerTag('master', releases), true);
  assert.equal(isRetainedContainerTag('test-debian', releases), true);
  assert.equal(isRetainedContainerTag('latestish', releases), false);
  assert.equal(isRetainedContainerTag('v2026.516.1438330', releases), false);
  assert.equal(isRetainedContainerTag('abcdef0-ubuntu-24.04', releases), false);
});

test('planDockerHubCleanup groups fully stale tags by digest', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  const old = '2026-09-01T00:00:00Z';
  const recent = '2026-09-06T11:00:00Z';
  const plan = planDockerHubCleanup([
    {name: 'v1.0.0', digest: 'sha256:keep', last_updated: old},
    {name: 'abcdef0', digest: 'sha256:keep', last_updated: old},
    {name: 'old-release', digest: 'sha256:stale', last_updated: old},
    {name: '1234567', digest: 'sha256:stale', last_updated: old},
    {name: 'new-build', digest: 'sha256:recent', last_updated: recent},
  ], new Set(['v1.0.0']), {now});

  assert.equal(plan.retained, 2);
  assert.equal(plan.selectedTags, 3);
  assert.deepEqual(
    plan.actions.map(({kind, digest, tag}) => [kind, digest, tag]),
    [
      ['tag', undefined, 'abcdef0'],
      ['manifest', 'sha256:stale', undefined],
    ],
  );
});

test('classifyGhcrVersions protects retained tags and the publish grace period', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  const version = (id, tags, updatedAt) => ({
    id,
    name: `sha256:${id}`,
    updated_at: updatedAt,
    metadata: {container: {tags}},
  });
  const classification = classifyGhcrVersions([
    version('release', ['v1.0.0', 'abcdef0'], '2026-09-01T00:00:00Z'),
    version('recent', [], '2026-09-06T11:00:00Z'),
    version('tagged', ['old'], '2026-09-01T00:00:00Z'),
    version('untagged', [], '2026-09-01T00:00:00Z'),
  ], new Set(['v1.0.0']), {now});

  assert.deepEqual(classification.roots.map(({id}) => id), ['release', 'recent']);
  assert.deepEqual(classification.staleTagged.map(({id}) => id), ['tagged']);
  assert.deepEqual(classification.staleUntagged.map(({id}) => id), ['untagged']);
});

test('resolveReachableDigests walks nested multi-arch manifest indexes', async () => {
  const manifests = new Map([
    ['sha256:root', {manifests: [{digest: 'sha256:amd64'}, {digest: 'sha256:arm64'}]}],
    ['sha256:amd64', {manifests: [{digest: 'sha256:provenance'}]}],
    ['sha256:arm64', {}],
    ['sha256:provenance', {}],
  ]);
  const reachable = await resolveReachableDigests(
    ['sha256:root'],
    async (digest) => manifests.get(digest),
  );

  assert.deepEqual(
    [...reachable].sort(),
    ['sha256:amd64', 'sha256:arm64', 'sha256:provenance', 'sha256:root'],
  );
});

test('ghcrCleanupCandidates preserves reachable untagged child manifests', () => {
  const classification = {
    roots: [{id: 'root', name: 'sha256:root'}],
    staleTagged: [{id: 'tagged', name: 'sha256:tagged'}],
    staleUntagged: [
      {id: 'child', name: 'sha256:child'},
      {id: 'orphan', name: 'sha256:orphan'},
    ],
  };
  const candidates = ghcrCleanupCandidates(
    classification,
    new Set(['sha256:root', 'sha256:child']),
  );

  assert.deepEqual(candidates.map(({id}) => id), ['tagged', 'orphan']);
});
