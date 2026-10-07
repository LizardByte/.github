import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';

import {forEachSequential} from '../.github/scripts/async-iteration.mjs';
import {createCleanupRuntime} from '../.github/scripts/cleanup-runtime.mjs';
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
    rows: [],
    writes: 0,
    addHeading() { return this; },
    addTable(rows) { this.rows = rows; return this; },
    async write() { this.writes += 1; },
  };
  return {info() {}, warning() {}, summary};
}

function githubResponses(github) {
  let remaining = 5000;
  return {
    ...github,
    async paginate(route, options, mapPage) {
      const data = await github.paginate(route, options);
      remaining -= 1;
      return mapPage({data, headers: {'x-ratelimit-remaining': String(remaining)}});
    },
    async request(route, options) {
      if (route === 'GET /rate_limit') {
        return {data: {resources: {core: {remaining}}}};
      }
      await github.request(route, options);
      remaining -= 1;
      return {status: 204, headers: {'x-ratelimit-remaining': String(remaining)}};
    },
  };
}

function cleanupGithub(repositories = ['Alpha'], releases = []) {
  return {
    rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
    async paginate(route) {
      return route === 'repos' ? repositories.map((name) => ({name})) : releases;
    },
  };
}

for (const kind of ['manifest', 'tag']) {
  test(`Docker Hub refreshes an expired token during ${kind} deletion and reuses it`, async (t) => {
    const old = '2020-01-01T00:00:00Z';
    let hubAuthentications = 0;
    let registryAuthentications = 0;
    const attempts = [];
    const scopes = [];
    t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname === '/v2/auth/token') {
        hubAuthentications += 1;
        return Response.json({access_token: `hub-${hubAuthentications}`});
      }
      if (url.hostname === 'auth.docker.io') {
        registryAuthentications += 1;
        scopes.push(url.searchParams.get('scope'));
        assert.equal(options.headers.Authorization, `Basic ${Buffer.from('user:token').toString('base64')}`);
        return Response.json({token: `registry-${registryAuthentications}`});
      }
      if (options.method === 'DELETE') {
        attempts.push({path: url.pathname, authorization: options.headers.Authorization});
        return attempts.length === 2
          ? new Response('token expired', {status: 401})
          : new Response(null, {status: 204});
      }
      if (url.pathname.endsWith('/repositories')) {
        return Response.json({results: [{name: 'alpha'}], next: null});
      }
      assert.ok(url.pathname.endsWith('/alpha/tags'));
      const tags = [1, 2, 3].map((id) => ({
        name: `old-${id}`, digest: kind === 'tag' ? 'sha256:keep' : `sha256:${id}`, last_updated: old,
      }));
      tags.push({name: 'latest', digest: 'sha256:keep', last_updated: old});
      return Response.json({results: tags, next: null});
    });

    const result = await cleanupDockerHub({
      github: cleanupGithub(), core: summaryCore(), username: 'user', accessToken: 'token',
      dryRun: false, maxDeletions: 3,
    });
    const service = kind === 'manifest' ? 'registry' : 'hub';
    assert.deepEqual(attempts.map(({authorization}) => authorization), [
      `Bearer ${service}-1`, `Bearer ${service}-1`, `Bearer ${service}-2`, `Bearer ${service}-2`,
    ]);
    assert.equal(attempts[1].path, attempts[2].path);
    assert.notEqual(attempts[2].path, attempts[3].path);
    assert.equal(hubAuthentications, kind === 'tag' ? 2 : 1);
    assert.equal(registryAuthentications, kind === 'manifest' ? 2 : 0);
    assert.deepEqual(scopes, kind === 'manifest'
      ? Array(2).fill('repository:lizardbyte/alpha:pull,push,delete') : []);
    assert.deepEqual(result, {
      repositories: 1, scanned: 4, selectedTags: 3, deletedActions: 3, deferredActions: 0,
    });
  });
}

for (const pageType of ['repository', 'tag']) {
  test(`Docker Hub refreshes an expired Hub token during ${pageType} pagination`, async (t) => {
    let hubAuthentications = 0;
    const secondPageAttempts = [];
    const tagDeleteTokens = [];
    t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname === '/v2/auth/token') {
        hubAuthentications += 1;
        return Response.json({access_token: `hub-${hubAuthentications}`});
      }
      if (options.method === 'DELETE') {
        tagDeleteTokens.push(options.headers.Authorization);
        return new Response(null, {status: 204});
      }
      const isRepositories = url.pathname.endsWith('/repositories');
      const paginate = isRepositories === (pageType === 'repository');
      const secondPage = url.searchParams.has('page');
      if (paginate && secondPage) {
        secondPageAttempts.push(options.headers.Authorization);
        if (secondPageAttempts.length === 1) {
          return new Response('token expired', {status: 401});
        }
      }
      const results = isRepositories
        ? [{name: secondPage ? 'beta' : 'alpha'}]
        : [{name: secondPage ? 'old-2' : 'old-1', last_updated: '2020-01-01T00:00:00Z'}];
      return Response.json({
        results, next: paginate && !secondPage ? `${url.origin}${url.pathname}?page=2` : null,
      });
    });

    const result = await cleanupDockerHub({
      github: cleanupGithub(['Alpha', 'Beta']), core: summaryCore(), username: 'user', accessToken: 'token',
      dryRun: false, maxDeletions: 2,
    });
    assert.deepEqual(secondPageAttempts, ['Bearer hub-1', 'Bearer hub-2']);
    assert.deepEqual(tagDeleteTokens, ['Bearer hub-2', 'Bearer hub-2']);
    assert.equal(hubAuthentications, 2);
    assert.equal(result.scanned, 2);
    assert.equal(result.deletedActions, 2);
    assert.equal(result.deferredActions, 0);
  });
}

for (const status of [401, 403, 500]) {
  test(`Docker Hub stops on persistent ${status} without unbounded retries`, async (t) => {
    let registryAuthentications = 0;
    let attempts = 0;
    t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname === '/v2/auth/token') {
        return Response.json({access_token: 'hub-token'});
      }
      if (url.hostname === 'auth.docker.io') {
        registryAuthentications += 1;
        return Response.json({token: `registry-${registryAuthentications}`});
      }
      if (options.method === 'DELETE') {
        attempts += 1;
        assert.ok(url.pathname.endsWith('/manifests/sha256:1'));
        return new Response('access denied', {status});
      }
      return Response.json({results: url.pathname.endsWith('/repositories') ? [{name: 'alpha'}]
        : [1, 2].map((id) => ({name: `old-${id}`, digest: `sha256:${id}`, last_updated: '2020-01-01'}))});
    });

    await assert.rejects(cleanupDockerHub({
      github: cleanupGithub(), core: summaryCore(), username: 'user', accessToken: 'token',
      dryRun: false, maxDeletions: 2,
    }), new RegExp(`^Error: ${status} .*access denied`));
    assert.equal(attempts, status === 401 ? 2 : 1);
    assert.equal(registryAuthentications, status === 401 ? 2 : 1);
  });
}

for (const maxDeletions of [undefined, 0]) {
  test(`Docker Hub cleans over 10000 stale entries without a limit (maxDeletions=${maxDeletions})`, async (t) => {
    const tags = Array.from({length: 10001}, (_, id) => ({
      name: `old-${id}`, digest: `sha256:${id}`, last_updated: '2020-01-01T00:00:00Z',
    }));
    // A retained alias on the final page must protect a digest seen on the first page.
    tags.push({name: 'latest', digest: 'sha256:0', last_updated: '2020-01-01T00:00:00Z'});
    let tagPages = 0;
    const deleted = [];
    t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname === '/v2/auth/token') {
        return Response.json({access_token: 'hub-token'});
      }
      if (url.hostname === 'auth.docker.io') {
        return Response.json({token: 'registry-token'});
      }
      if (options.method === 'DELETE') {
        deleted.push(url.pathname);
        return new Response(null, {status: 204});
      }
      if (url.pathname.endsWith('/repositories')) {
        return Response.json({results: [{name: 'alpha'}]});
      }
      assert.ok(url.pathname.endsWith('/alpha/tags'));
      tagPages += 1;
      const page = Number(url.searchParams.get('page') ?? 1);
      return Response.json({
        results: tags.slice((page - 1) * 100, page * 100),
        next: page * 100 < tags.length ? `${url.origin}${url.pathname}?page=${page + 1}` : null,
      });
    });

    const result = await cleanupDockerHub({
      github: cleanupGithub(), core: summaryCore(), username: 'user', accessToken: 'token',
      dryRun: false, maxDeletions,
    });
    assert.deepEqual(result, {
      repositories: 1, scanned: 10002, selectedTags: 10001, deletedActions: 10001, deferredActions: 0,
    });
    assert.equal(tagPages, 101);
    assert.equal(deleted.length, 10001);
    assert.ok(deleted.includes('/v2/namespaces/lizardbyte/repositories/alpha/tags/old-0'));
    assert.ok(!deleted.includes('/v2/lizardbyte/alpha/manifests/sha256:0'));
  });
}

for (const cleanup of [cleanupDockerHub, cleanupGhcr]) {
  test(`${cleanup.name} rejects invalid deletion limits before accessing either registry`, async (t) => {
    t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected registry request'));
    const github = {paginate() { assert.fail('Unexpected GitHub request'); }};
    await Promise.all([-1, 1.5, NaN, Infinity, null, '3'].map((maxDeletions) => assert.rejects(cleanup({
      github, core: summaryCore(), username: 'user', accessToken: 'token', dryRun: false, maxDeletions,
    }), /maxDeletions must be a positive integer, zero, or omitted/)));
  });
}

for (const dryRun of [false, true]) {
  test(`Docker Hub cleans themerr and themerr-plex using Themerr releases (dryRun=${dryRun})`, async (t) => {
    const releaseRepositories = [];
    const deleted = [];
    const scopes = [];
    const core = summaryCore();
    const warnings = [];
    core.warning = (message) => warnings.push(message);
    const github = cleanupGithub(['Themerr'], [{tag_name: 'v1.0.0', draft: false}]);
    const paginate = github.paginate;
    github.paginate = async (route, options) => {
      if (route === 'releases') {
        releaseRepositories.push(options.repo);
      }
      return paginate(route, options);
    };
    t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname === '/v2/auth/token') {
        return Response.json({access_token: 'hub-token'});
      }
      if (url.hostname === 'auth.docker.io') {
        scopes.push(url.searchParams.get('scope'));
        return Response.json({token: 'registry-token'});
      }
      if (options.method === 'DELETE') {
        deleted.push(url.pathname);
        return new Response(null, {status: 204});
      }
      if (url.pathname.endsWith('/repositories')) {
        return Response.json({results: [{name: 'themerr-plex'}, {name: 'themerr'}, {name: 'unmapped'}]});
      }
      assert.match(url.pathname, /\/repositories\/themerr(?:-plex)?\/tags$/);
      return Response.json({results: [
        ...['v1.0.0', 'v1.0.0-ubuntu', 'latest', 'stale-build'].map((name) => ({
          name, digest: `sha256:${name}`, last_updated: '2020-01-01T00:00:00Z',
        })),
        {name: 'recent-build', digest: 'sha256:recent', last_updated: new Date().toISOString()},
      ]});
    });

    const result = await cleanupDockerHub({
      github, core, username: 'user', accessToken: 'token', dryRun,
    });
    assert.deepEqual(releaseRepositories, ['Themerr', 'Themerr']);
    assert.deepEqual(deleted, dryRun ? [] : [
      '/v2/lizardbyte/themerr/manifests/sha256:stale-build',
      '/v2/lizardbyte/themerr-plex/manifests/sha256:stale-build',
    ]);
    assert.deepEqual(scopes, dryRun ? [] : [
      'repository:lizardbyte/themerr:pull,push,delete',
      'repository:lizardbyte/themerr-plex:pull,push,delete',
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unmapped: no matching GitHub repository/);
    assert.deepEqual(result, {
      repositories: 3, scanned: 10, selectedTags: 2, deletedActions: 2, deferredActions: 0,
    });
  });
}

test('GHCR cleans legacy themerr-plex versions against Themerr releases and preserves children', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.pathname === '/token') {
      assert.equal(url.searchParams.get('scope'), 'repository:lizardbyte/themerr-plex:pull');
      return Response.json({token: 'registry-token'});
    }
    return Response.json(url.pathname.endsWith('/manifests/sha256:root')
      ? {manifests: [{digest: 'sha256:child'}]} : {});
  });
  const deleted = [];
  const github = {
    rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
    async paginate(route, options) {
      if (route === 'repos') {
        return [{name: 'Themerr'}];
      }
      if (route === 'releases') {
        assert.equal(options.repo, 'Themerr');
        return [{tag_name: 'v1.0.0', draft: false}];
      }
      if (!options.package_name) {
        return [{name: 'themerr-plex'}];
      }
      assert.equal(options.package_name, 'themerr-plex');
      return [
        {id: 'root', name: 'sha256:root', metadata: {container: {tags: ['v1.0.0']}}},
        {id: 'stale', name: 'sha256:stale', metadata: {container: {tags: ['stale-build']}}},
        {id: 'child', name: 'sha256:child', metadata: {container: {tags: []}}},
        {id: 'orphan', name: 'sha256:orphan', metadata: {container: {tags: []}}},
      ];
    },
    async request(route, options) {
      assert.equal(options.package_name, 'themerr-plex');
      deleted.push(options.package_version_id);
    },
  };

  const result = await cleanupGhcr({
    github: githubResponses(github), core: summaryCore(), username: 'user', accessToken: 'token', dryRun: false,
  });
  assert.deepEqual(deleted, ['stale', 'orphan']);
  assert.deepEqual(result, {packages: 1, scanned: 4, selected: 2, operations: 2, deleted: 2, deferred: 0});
});

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

for (const maxDeletions of [3, undefined, 0]) {
  for (const dryRun of [false, true]) {
    const description = `GHCR respects package ordering and limits (maxDeletions=${maxDeletions}, dryRun=${dryRun})`;
    test(description, async (t) => {
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
        github: githubResponses(github), core: summaryCore(), username: 'user', accessToken: 'token',
        dryRun, maxDeletions,
      });
      const limited = maxDeletions === 3;
      assert.deepEqual(result, {
        packages: 2, scanned: 4, selected: 4, operations: limited ? 3 : 4,
        deleted: dryRun ? 0 : (limited ? 3 : 4), deferred: limited ? 1 : 0,
      });
      const expectedEvents = ['start alpha/parent', 'end alpha/parent', 'start alpha/child', 'end alpha/child',
        'start beta/parent', 'end beta/parent'];
      if (!limited) {
        expectedEvents.push('start beta/child', 'end beta/child');
      }
      assert.deepEqual(events, dryRun ? [] : expectedEvents);
    });
  }
}

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
    github: githubResponses(github), core: summaryCore(), username: 'user', accessToken: 'token',
    dryRun: false, maxDeletions: 3,
  });
  assert.equal(result.operations, 0);
  assert.equal(result.selected, 0);
});

function ghcrRateFixture(t, {remaining = 1000, versionPageSize = 100, onResponse, onRegistryResponse} = {}) {
  const calls = [];
  const deleted = [];
  const manifests = [];
  const core = summaryCore();
  const warnings = [];
  core.warning = (message) => warnings.push(message);
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'ghcr.io');
    if (url.pathname === '/token') {
      return Response.json({token: 'registry-token'});
    }
    manifests.push(url.pathname);
    const response = Response.json(url.pathname.endsWith('/sha256:root')
      ? {manifests: [{digest: 'sha256:child'}]} : {});
    return onRegistryResponse?.(url, response) ?? response;
  });

  const versions = [
    {id: 'root', name: 'sha256:root', metadata: {container: {tags: ['v1.0.0']}}},
    {id: 'child', name: 'sha256:child', metadata: {container: {tags: []}}},
    {id: 'parent-1', name: 'sha256:parent-1', metadata: {container: {tags: ['old-1']}}},
    {id: 'parent-2', name: 'sha256:parent-2', metadata: {container: {tags: ['old-2']}}},
    {id: 'orphan', name: 'sha256:orphan', metadata: {container: {tags: []}}},
  ];
  const respond = (call, data, headers = {}) => {
    calls.push(call);
    if (call.route !== 'GET /rate_limit') {
      remaining -= 1;
    }
    const response = {
      status: call.route.startsWith('DELETE') ? 204 : 200, data,
      headers: {'x-ratelimit-remaining': String(remaining), ...headers},
    };
    return onResponse?.(call, response) ?? response;
  };
  const github = {
    rest: {repos: {listForOrg: 'repos', listReleases: 'releases'}},
    async paginate(route, options, mapPage) {
      const data = route === 'repos' ? [{name: 'Alpha'}, {name: 'Beta'}]
        : route === 'releases' ? [{tag_name: 'v1.0.0', draft: false}]
          : options.package_name ? versions : [{name: 'alpha'}, {name: 'beta'}];
      const pageSize = options.package_name ? versionPageSize : 100;
      const pages = Array.from({length: Math.ceil(data.length / pageSize)}, (_, index) => index + 1);
      const results = [];
      // A page callback failure must prevent the next HTTP request, as it does in Octokit.
      await forEachSequential(pages, async (page) => {
        await setImmediate();
        const headers = page < pages.length ? {link: '<https://api.github.com/mock?page=2>; rel="next"'} : {};
        const response = respond({route, options, page}, data.slice((page - 1) * pageSize, page * pageSize), headers);
        results.push(...mapPage(response));
      });
      return results;
    },
    async request(route, options = {}) {
      const data = route === 'GET /rate_limit' ? {resources: {core: {remaining}}} : undefined;
      const response = await respond({route, options}, data);
      if (route.startsWith('DELETE')) {
        deleted.push(`${options.package_name}/${options.package_version_id}`);
      }
      return response;
    },
  };
  return {
    calls, deleted, manifests, core, warnings,
    run: (options = {}) => cleanupGhcr({
      github, core, username: 'user', accessToken: 'token', dryRun: false, ...options,
    }),
  };
}

function ghcrSummary(fixture) {
  assert.equal(fixture.core.summary.writes, 1);
  return Object.fromEntries(fixture.core.summary.rows.map(([key, value]) => [key.data, value.data]));
}

function githubFailure(status, headers, message) {
  return Object.assign(new Error(message), {status, response: {status, headers, data: {message}}});
}

for (const remaining of [0, 499, 500]) {
  test(`GHCR makes no charged API calls when ${remaining} remain`, async (t) => {
    const fixture = ghcrRateFixture(t, {remaining});
    const result = await fixture.run();
    assert.deepEqual(result, {packages: 0, scanned: 0, selected: 0, operations: 0, deleted: 0, deferred: 0});
    assert.deepEqual(fixture.calls.map(({route}) => route), ['GET /rate_limit']);
    assert.deepEqual(fixture.deleted, []);
    assert.deepEqual(fixture.manifests, []);
    const summary = ghcrSummary(fixture);
    assert.match(summary.Status, /500-call reserve/);
    assert.equal(summary['GitHub API calls remaining'], String(remaining));
    assert.equal(summary['Versions deleted'], '0');
    assert.equal(summary['Inventory scan'], 'Partial');
  });
}

test('GHCR reserves exactly 500 calls and summarizes the deletion completed before stopping', async (t) => {
  const fixture = ghcrRateFixture(t, {remaining: 505});
  const result = await fixture.run();
  assert.deepEqual(result, {packages: 2, scanned: 5, selected: 3, operations: 1, deleted: 1, deferred: 2});
  assert.deepEqual(fixture.deleted, ['alpha/parent-1']);
  assert.equal(fixture.calls.length, 6); // One free budget query, four metadata reads, and one deletion.
  assert.ok(!fixture.calls.some(({options}) => options.package_name === 'beta'));
  const summary = ghcrSummary(fixture);
  assert.equal(summary['Versions deleted'], '1');
  assert.equal(summary['Known versions deferred'], '2');
  assert.equal(summary['GitHub API calls remaining'], '500');
  assert.equal(summary['GitHub API reserve target'], '500');
  assert.equal(summary['Inventory scan'], 'Partial');
  assert.equal(fixture.warnings.length, 1);
});

test('GHCR stops between inventory pages and never plans deletion from a partial inventory', async (t) => {
  const fixture = ghcrRateFixture(t, {remaining: 504, versionPageSize: 2});
  const result = await fixture.run();
  assert.deepEqual(result, {packages: 2, scanned: 0, selected: 0, operations: 0, deleted: 0, deferred: 0});
  assert.deepEqual(fixture.calls.filter(({options}) => options.package_name).map(({page}) => page), [1, 2]);
  assert.ok(!fixture.calls.some(({route}) => route === 'releases'));
  assert.deepEqual(fixture.deleted, []);
  assert.deepEqual(fixture.manifests, []);
  assert.equal(ghcrSummary(fixture)['GitHub API calls remaining'], '500');
});

const rateLimitFailures = [
  [403, {'x-ratelimit-remaining': '0'}, 'API rate limit exceeded'],
  [403, {'x-ratelimit-remaining': '995', 'retry-after': '60'}, 'Request throttled'],
  [403, {'x-ratelimit-remaining': '995'}, 'You have exceeded a secondary rate limit'],
  [403, {'x-ratelimit-remaining': '995'}, 'Forbidden', 'You have exceeded a secondary rate limit'],
  [429, {'x-ratelimit-remaining': '995'}, 'Too many requests'],
];
for (const [status, headers, message, apiMessage = message] of rateLimitFailures) {
  test(`GHCR stops cleanly on ${status} ${message} and counts only successful deletions`, async (t) => {
    const fixture = ghcrRateFixture(t, {
      onResponse(call, response) {
        if (call.options.package_version_id === 'parent-2') {
          const failure = githubFailure(status, headers, message);
          failure.response.data.message = apiMessage;
          throw failure;
        }
        return response;
      },
    });
    const result = await fixture.run();
    assert.deepEqual(result, {packages: 2, scanned: 5, selected: 3, operations: 1, deleted: 1, deferred: 2});
    assert.deepEqual(fixture.deleted, ['alpha/parent-1']);
    assert.equal(fixture.calls.filter(({route}) => route.startsWith('DELETE')).length, 2);
    assert.ok(!fixture.calls.some(({options}) => options.package_name === 'beta'));
    const summary = ghcrSummary(fixture);
    assert.match(summary.Status, /rate limit reached/);
    assert.equal(summary['Versions deleted'], '1');
    assert.equal(summary['Known versions deferred'], '2');
    assert.equal(summary['GitHub API calls remaining'], headers['x-ratelimit-remaining']);
    assert.equal(fixture.warnings.length, 1);
  });
}

test('GHCR preserves prior deletion counts if a later package inventory is rate limited', async (t) => {
  const fixture = ghcrRateFixture(t, {
    versionPageSize: 2,
    onResponse(call, response) {
      if (call.options.package_name === 'beta' && call.page === 2) {
        throw githubFailure(403, {'x-ratelimit-remaining': '0'}, 'API rate limit exceeded');
      }
      return response;
    },
  });
  const result = await fixture.run();
  assert.deepEqual(result, {packages: 2, scanned: 5, selected: 3, operations: 3, deleted: 3, deferred: 0});
  assert.deepEqual(fixture.deleted, ['alpha/parent-1', 'alpha/parent-2', 'alpha/orphan']);
  const summary = ghcrSummary(fixture);
  assert.equal(summary['Versions deleted'], '3');
  assert.equal(summary['Inventory scan'], 'Partial');
  assert.equal(summary['GitHub API calls remaining'], '0');
});

test('GHCR dry runs use the reserve guard and report zero actual deletions', async (t) => {
  const fixture = ghcrRateFixture(t, {remaining: 505});
  const result = await fixture.run({dryRun: true});
  assert.deepEqual(result, {packages: 2, scanned: 5, selected: 3, operations: 3, deleted: 0, deferred: 0});
  assert.deepEqual(fixture.deleted, []);
  const summary = ghcrSummary(fixture);
  assert.equal(summary.Mode, 'Dry run');
  assert.equal(summary['Versions deleted'], '0');
  assert.equal(summary['Delete operations processed'], '3');
  assert.equal(summary['GitHub API calls remaining'], '500');
});

for (const status of [403, 500]) {
  test(`GHCR preserves its summary but still fails for an unrelated ${status} error`, async (t) => {
    const failure = githubFailure(status, {'x-ratelimit-remaining': '995'}, 'Resource not accessible');
    const fixture = ghcrRateFixture(t, {
      onResponse(call, response) {
        if (call.options.package_version_id === 'parent-2') {
          throw failure;
        }
        return response;
      },
    });
    await assert.rejects(fixture.run(), (error) => error === failure);
    assert.deepEqual(fixture.deleted, ['alpha/parent-1']);
    const summary = ghcrSummary(fixture);
    assert.match(summary.Status, /^Failed: Resource not accessible/);
    assert.equal(summary['Versions deleted'], '1');
    assert.equal(summary['Known versions deferred'], '2');
    assert.deepEqual(fixture.warnings, []);
  });
}

test('GHCR writes a zero-deletion summary if the initial rate limit query is throttled', async (t) => {
  const fixture = ghcrRateFixture(t, {
    onResponse() { throw githubFailure(429, {'x-ratelimit-remaining': '0'}, 'Too many requests'); },
  });
  const result = await fixture.run();
  assert.equal(result.deleted, 0);
  assert.equal(fixture.calls.length, 1);
  const summary = ghcrSummary(fixture);
  assert.equal(summary['Versions deleted'], '0');
  assert.equal(summary['GitHub API calls remaining'], '0');
});

test('GHCR stops safely if it cannot determine the initial API budget', async (t) => {
  const fixture = ghcrRateFixture(t, {onResponse() { return {headers: {}, data: {}}; }});
  const result = await fixture.run();
  assert.equal(result.deleted, 0);
  assert.equal(fixture.calls.length, 1);
  const summary = ghcrSummary(fixture);
  assert.match(summary.Status, /Cannot determine/);
  assert.equal(summary['GitHub API calls remaining'], 'Unknown');
});

test('GHCR conservatively counts requests when response rate limit headers are unavailable', async (t) => {
  const fixture = ghcrRateFixture(t, {
    remaining: 505,
    onResponse(call, response) { return {...response, headers: {}}; },
  });
  const result = await fixture.run();
  assert.equal(result.deleted, 1);
  assert.deepEqual(fixture.deleted, ['alpha/parent-1']);
  assert.equal(ghcrSummary(fixture)['GitHub API calls remaining'], '500');
});

for (const kind of ['manifest', 'tag']) {
  for (const dryRun of [false, true]) {
    test(`Docker Hub writes progress when its time budget stops ${kind} cleanup (dryRun=${dryRun})`, async (t) => {
      let now = 0;
      const runtime = createCleanupRuntime({maxRuntimeMs: 1000, now: () => now});
      const core = summaryCore();
      const deleted = [];
      if (dryRun) {
        core.info = () => { now = 1000; };
      }
      t.mock.method(globalThis, 'fetch', async (input, options) => {
        const url = new URL(input);
        if (url.pathname === '/v2/auth/token') {
          return Response.json({token: 'hub-token'});
        }
        if (url.hostname === 'auth.docker.io') {
          return Response.json({token: 'registry-token'});
        }
        if (options.method === 'DELETE') {
          deleted.push(url.pathname);
          now = 1000;
          return new Response(null, {status: 204});
        }
        if (url.pathname.endsWith('/repositories')) {
          return Response.json({results: [{name: 'alpha'}, {name: 'beta'}]});
        }
        assert.ok(url.pathname.endsWith('/alpha/tags'));
        const tags = kind === 'manifest' ? [
          {name: 'old-1a', digest: 'sha256:1'}, {name: 'old-1b', digest: 'sha256:1'},
          {name: 'old-2', digest: 'sha256:2'},
        ] : [{name: 'old-1'}, {name: 'old-2'}];
        return Response.json({results: tags.map((tag) => ({...tag, last_updated: '2020-01-01'}))});
      });
      const result = await cleanupDockerHub({
        github: cleanupGithub(['Alpha', 'Beta']), core, username: 'user', accessToken: 'token', dryRun, runtime,
      });
      assert.equal(result.deletedActions, 1);
      assert.equal(result.deferredActions, 1);
      assert.equal(deleted.length, dryRun ? 0 : 1);
      assert.equal(core.summary.writes, 1);
      const summary = Object.fromEntries(core.summary.rows.map(([key, value]) => [key.data, value.data]));
      assert.match(summary.Status, /time budget reached/);
      assert.equal(summary['Inventory scan'], 'Partial');
      assert.equal(summary['Delete operations completed'], dryRun ? '0' : '1');
      assert.equal(summary['Tags cleaned'], dryRun ? '0' : String(kind === 'manifest' ? 2 : 1));
      assert.equal(summary['Known operations deferred'], '1');
    });
  }
}

test('Docker Hub never deletes from a tag inventory cut short by the time budget', async (t) => {
  let now = 0;
  const runtime = createCleanupRuntime({maxRuntimeMs: 1000, now: () => now});
  const core = summaryCore();
  let tagPages = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.notEqual(options.method, 'DELETE');
    const url = new URL(input);
    if (url.pathname === '/v2/auth/token') {
      return Response.json({token: 'hub-token'});
    }
    if (url.pathname.endsWith('/repositories')) {
      return Response.json({results: [{name: 'alpha'}]});
    }
    tagPages += 1;
    now = 1000;
    return Response.json({
      results: [{name: 'stale', digest: 'sha256:1', last_updated: '2020-01-01'}],
      next: `${url.origin}${url.pathname}?page=2`,
    });
  });
  const result = await cleanupDockerHub({
    github: cleanupGithub(), core, username: 'user', accessToken: 'token', dryRun: false, runtime,
  });
  assert.equal(tagPages, 1);
  assert.equal(result.deletedActions, 0);
  assert.equal(core.summary.writes, 1);
});

for (const stall of [false, true]) {
  test(`Docker Hub reports prior deletions when a later delete ${stall ? 'stalls' : 'fails'}`, async (t) => {
    const core = summaryCore();
    const runtime = createCleanupRuntime({maxRuntimeMs: 100});
    const keepAlive = setTimeout(() => {}, 1000);
    t.after(() => clearTimeout(keepAlive));
    let attempts = 0;
    let stalledSignal;
    t.mock.method(globalThis, 'fetch', async (input, options) => {
      const url = new URL(input);
      if (url.pathname === '/v2/auth/token') {
        return Response.json({token: 'hub-token'});
      }
      if (options.method === 'DELETE') {
        attempts += 1;
        if (attempts === 2) {
          stalledSignal = options.signal;
          return stall ? new Promise(() => {}) : new Response('server failure', {status: 500});
        }
        return new Response(null, {status: 204});
      }
      return Response.json({results: url.pathname.endsWith('/repositories') ? [{name: 'alpha'}]
        : [1, 2, 3].map((id) => ({name: `old-${id}`, last_updated: '2020-01-01'}))});
    });
    const cleanup = cleanupDockerHub({
      github: cleanupGithub(), core, username: 'user', accessToken: 'token', dryRun: false, runtime,
    });
    if (stall) {
      assert.equal((await cleanup).deletedActions, 1);
      assert.equal(stalledSignal.aborted, true);
    } else {
      await assert.rejects(cleanup, /500/);
    }
    assert.equal(attempts, 2);
    assert.equal(core.summary.writes, 1);
    const summary = Object.fromEntries(core.summary.rows.map(([key, value]) => [key.data, value.data]));
    assert.equal(summary['Delete operations completed'], '1');
    assert.equal(summary['Known operations deferred'], '2');
    assert.match(summary.Status, stall ? /time budget reached/ : /^Failed:/);
  });
}

test('GHCR summarizes confirmed deletions before its time budget stops further packages', async (t) => {
  let now = 0;
  const runtime = createCleanupRuntime({maxRuntimeMs: 1000, now: () => now});
  const fixture = ghcrRateFixture(t, {
    onResponse(call, response) {
      if (call.options.package_version_id === 'parent-1') {
        now = 1000;
      }
      return response;
    },
  });
  const result = await fixture.run({runtime});
  assert.equal(result.deleted, 1);
  assert.equal(result.deferred, 2);
  assert.deepEqual(fixture.deleted, ['alpha/parent-1']);
  const summary = ghcrSummary(fixture);
  assert.match(summary.Status, /time budget reached/);
  assert.equal(summary['Versions deleted'], '1');
  assert.equal(summary['Known versions deferred'], '2');
});

test('GHCR propagates a manifest graph deadline to the cleanup summary', async (t) => {
  let now = 0;
  const runtime = createCleanupRuntime({maxRuntimeMs: 1000, now: () => now});
  const fixture = ghcrRateFixture(t, {
    onRegistryResponse(url, response) { now = 1000; return response; },
  });
  const result = await fixture.run({runtime});
  assert.equal(result.deleted, 0);
  assert.equal(fixture.manifests.length, 1);
  assert.equal(fixture.warnings.length, 1);
  assert.match(ghcrSummary(fixture).Status, /time budget reached/);
});

test('GHCR stops inventory pagination at its deadline without making a deletion plan', async (t) => {
  let now = 0;
  const runtime = createCleanupRuntime({maxRuntimeMs: 1000, now: () => now});
  const fixture = ghcrRateFixture(t, {
    versionPageSize: 2,
    onResponse(call, response) { if (call.options.package_name) { now = 1000; } return response; },
  });
  const result = await fixture.run({runtime});
  assert.equal(result.selected, 0);
  assert.equal(fixture.calls.filter(({options}) => options.package_name).length, 1);
  assert.match(ghcrSummary(fixture).Status, /time budget reached/);
});

test('GHCR writes its summary when an in-flight deletion stalls until the deadline', async (t) => {
  const runtime = createCleanupRuntime({maxRuntimeMs: 100});
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  let stalledSignal;
  const fixture = ghcrRateFixture(t, {
    onResponse(call, response) {
      if (call.options.package_version_id === 'parent-2') {
        stalledSignal = call.options.request.signal;
        return new Promise(() => {});
      }
      return response;
    },
  });
  const result = await fixture.run({runtime});
  assert.equal(stalledSignal.aborted, true);
  assert.equal(result.deleted, 1);
  assert.deepEqual(fixture.deleted, ['alpha/parent-1']);
  assert.equal(ghcrSummary(fixture)['Versions deleted'], '1');
});
