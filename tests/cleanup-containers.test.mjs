import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';

import {
  classifyGhcrVersions,
  cleanupDockerHub,
  cleanupGhcr,
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

test('resolveReachableDigests reads cyclic and duplicate digests only once', async () => {
  const loaded = [];
  const reachable = await resolveReachableDigests(['root', 'root', null], async (digest) => {
    loaded.push(digest);
    return {manifests: [{digest: 'root'}, {digest: 'child'}, {digest: 'child'}]};
  });
  assert.deepEqual(loaded, ['root', 'child']);
  assert.deepEqual([...reachable], ['root', 'child']);
});

function summaryCore() {
  const summary = {
    addHeading() { return this; },
    addTable() { return this; },
    async write() {},
  };
  return {info() {}, warning() {}, summary};
}

for (const dryRun of [false, true]) {
  test(`Docker Hub cleanup respects pagination and a shared deletion budget (dryRun=${dryRun})`, async (t) => {
    const old = '2020-01-01T00:00:00Z';
    const deleted = [];
    let registryAuthentications = 0;
    t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
      const url = new URL(input);
      if (options.method === 'DELETE') {
        deleted.push(url.pathname);
        await setImmediate();
        return new Response(null, {status: 204});
      }
      let data;
      if (url.pathname === '/v2/auth/token') {
        data = {access_token: 'hub-token'};
      } else if (url.hostname === 'auth.docker.io') {
        registryAuthentications += 1;
        data = {token: 'registry-token'};
      } else if (url.pathname.endsWith('/repositories')) {
        data = url.searchParams.has('page')
          ? {results: [{name: 'alpha'}], next: null}
          : {results: [{name: 'beta'}], next: `${url.origin}${url.pathname}?page=2`};
      } else if (url.pathname.endsWith('/alpha/tags')) {
        data = url.searchParams.has('page')
          ? {results: [{name: 'older-2', digest: 'sha256:a2', last_updated: old}], next: null}
          : {
            results: [{name: 'older-1', digest: 'sha256:a1', last_updated: old}],
            next: `${url.origin}${url.pathname}?page=2`,
          };
      } else if (url.pathname.endsWith('/beta/tags')) {
        data = {results: [{name: 'older', digest: 'sha256:b', last_updated: old}], next: null};
      } else {
        assert.fail(`Unexpected request: ${url}`);
      }
      return Response.json(data);
    });
    const github = {
      rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
      async paginate(route) {
        return route === 'repos' ? [{name: 'Alpha'}, {name: 'Beta'}] : [];
      },
    };

    const result = await cleanupDockerHub({
      github, core: summaryCore(), username: 'user', accessToken: 'token', dryRun, maxDeletions: 2,
    });
    assert.deepEqual(result, {repositories: 2, scanned: 3, selectedTags: 3, deletedActions: 2, deferredActions: 1});
    assert.deepEqual(deleted, dryRun ? [] : ['/v2/lizardbyte/alpha/manifests/sha256:a1',
      '/v2/lizardbyte/alpha/manifests/sha256:a2']);
    assert.equal(registryAuthentications, dryRun ? 0 : 1);
  });
}

test('GHCR deletes parents before children and carries its deletion budget across packages', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({token: 'registry-token'}));
  const events = [];
  const github = {
    rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
    async paginate(route, options) {
      if (route === 'repos') {
        return [{name: 'Alpha'}, {name: 'Beta'}];
      }
      if (route === 'releases') {
        return [];
      }
      if (options.package_name) {
        return [
          {id: 'child', name: 'child', metadata: {container: {tags: []}}},
          {id: 'parent', name: 'parent', metadata: {container: {tags: ['old']}}},
        ];
      }
      return [{name: 'beta'}, {name: 'alpha'}];
    },
    async request(route, options) {
      const label = `${options.package_name}/${options.package_version_id}`;
      events.push(`start ${label}`);
      await setImmediate();
      events.push(`end ${label}`);
    },
  };
  const result = await cleanupGhcr({
    github, core: summaryCore(), username: 'user', accessToken: 'token', dryRun: false, maxDeletions: 3,
  });
  assert.deepEqual(result, {packages: 2, scanned: 4, selected: 4, operations: 3, deferred: 1});
  assert.deepEqual(events, ['start alpha/parent', 'end alpha/parent', 'start alpha/child', 'end alpha/child',
    'start beta/parent', 'end beta/parent']);
});

test('GHCR makes no deletions when a retained manifest cannot be read', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    return url.pathname === '/token'
      ? Response.json({token: 'registry-token'})
      : new Response('unavailable', {status: 503});
  });
  const github = {
    rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
    async paginate(route, options) {
      if (route === 'repos') {
        return [{name: 'Alpha'}];
      }
      if (route === 'releases') {
        return [];
      }
      return options.package_name ? [
        {id: 'retained', name: 'root', metadata: {container: {tags: ['latest']}}},
        {id: 'stale', name: 'stale', metadata: {container: {tags: ['old']}}},
      ] : [{name: 'alpha'}];
    },
    async request() { assert.fail('Unsafe deletion'); },
  };
  const result = await cleanupGhcr({
    github, core: summaryCore(), username: 'user', accessToken: 'token', dryRun: false, maxDeletions: 3,
  });
  assert.equal(result.operations, 0);
  assert.equal(result.selected, 0);
});
