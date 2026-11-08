import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {GitLabMirrors, mirrorRepositories, mirrorTarget, prepareMirrors} from '../.github/scripts/gitlab-mirror.mjs';

const root = {id: 1, full_path: 'lizardbyte', visibility: 'public', parent_id: null};
const group = {id: 2, full_path: 'lizardbyte/sunshinestream', visibility: 'public', parent_id: 1};
function target(owner = 'SunshineStream', name = 'Sunshine', id = 99, visibility = 'public') {
  return mirrorTarget({id, owner: {login: owner}, name, full_name: `${owner}/${name}`,
    clone_url: `https://github.com/${owner}/${name}.git`, size: 100, visibility}, 'lizardbyte', 'LizardByte');
}
function harness(routes) {
  const calls = [];
  const client = new GitLabMirrors({gitlabToken: 'gitlab-secret', githubToken: 'github-secret', sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      const key = `${options.method ?? 'GET'} ${url.replace('https://gitlab.com/api/v4', '')}`;
      calls.push({key, options, body: options.body ? JSON.parse(options.body) : undefined});
      assert.ok(key in routes, `Unexpected request: ${key}`);
      const result = typeof routes[key] === 'function' ? routes[key](calls.at(-1)) : routes[key];
      if (result instanceof Error) throw result;
      const [status, data] = result;
      return {status, ok: status >= 200 && status < 300, json: async () => data};
    }});
  return {client, calls};
}
const base = {'GET /groups/lizardbyte': [200, root], 'GET /groups/lizardbyte%2Fsunshinestream': [200, group]};
const missing = {'GET /projects/lizardbyte%2Fsunshinestream%2FSunshine': [404, {}],
  'GET /projects/lizardbyte%2FSunshine': [404, {}]};

test('qualified exclusions do not hide another org sharing that repository name', () => {
  const sources = ['LizardByte/ignored', 'Other/ignored', 'Other/repo-ghsa-2345-6789-cfgh'].map((name, index) => ({
    id: index + 1, owner: {login: name.split('/')[0]}, name: name.split('/')[1], full_name: name,
    clone_url: `https://github.com/${name}.git`, size: 1, visibility: 'public',
  }));
  assert.deepEqual(mirrorRepositories(sources, ['lizardbyte/ignored'], 'lizardbyte', 'LizardByte').map(r => r.name), ['Other/ignored']);
  assert.throws(() => mirrorRepositories(sources, ['ignored'], 'lizardbyte', 'LizardByte'), /qualified owner/);
});

test('target paths retain legacy spelling and stable normalization, with separate namespaces for same-name repos', () => {
  assert.equal(target('LizardByte').targetGroup, 'lizardbyte');
  assert.equal(target().targetGroup, 'lizardbyte/sunshinestream');
  assert.equal(target('Themerr', '.github', 7).targetPath, 'dot-github-7');
  assert.equal(target('Other', '.github', 8).targetPath, 'dot-github-8');
  assert.equal(target('Other', 'repo.git').targetPath, 'repo.git-repo-99');
  assert.equal(target('Other', 'secret', 9, 'internal').targetVisibility, 'private');
  assert.throws(() => mirrorTarget({clone_url: 'bad'}, 'lizardbyte', 'LizardByte'), /Invalid mirror source/);
});

test('missing subgroups are created under the existing root and cached, retaining display names and visibility', async () => {
  const {client, calls} = harness({...base, ...missing,
    'GET /groups/lizardbyte%2Fsunshinestream': [404, {}], 'POST /groups': [201, group]});
  assert.equal((await client.prepare(target())).namespaceId, 2);
  assert.equal((await client.prepare(target())).namespaceId, 2);
  const requests = calls.filter(c => c.key === 'POST /groups');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, {parent_id: 1, name: 'SunshineStream', path: 'sunshinestream', visibility: 'public', auto_devops_enabled: false});
});

test('group creation races are reread and inaccessible or incorrect parents fail closed', async () => {
  let reads = 0;
  const {client} = harness({...base,
    'GET /groups/lizardbyte%2Fsunshinestream': () => ++reads === 1 ? [404, {}] : [200, group],
    'POST /groups': [409, {}]});
  assert.equal((await client.group(group.full_path)).id, 2);
  for (const response of [[403, {}], [200, {...group, parent_id: 9}], [200, {...group, full_path: 'wrong'}]]) {
    const run = harness({...base, 'GET /groups/lizardbyte%2Fsunshinestream': response});
    await assert.rejects(run.client.prepare(target()), /GitLab group|subgroup parent/);
  }
});

test('a redirected legacy GitHub URL proves identity before transferring the original GitLab project ID', async () => {
  const legacy = {id: 42, path_with_namespace: 'lizardbyte/Sunshine', namespace: {id: 1},
    description: 'Mirror of https://github.com/LizardByte/Sunshine.git'};
  let polls = 0;
  const {client, calls} = harness({...base, ...missing,
    'GET /projects/lizardbyte%2FSunshine': [200, legacy],
    'GET https://api.github.com/repos/LizardByte/Sunshine': [200, {id: 99}],
    'PUT /projects/42/transfer': [201, legacy],
    'GET /projects/42': () => [200, ++polls === 1 ? legacy : {...legacy, namespace: {id: 2}, path_with_namespace: 'lizardbyte/sunshinestream/Sunshine'}],
  });
  assert.equal((await client.prepare(target())).namespaceId, 2);
  assert.deepEqual(calls.find(c => c.key === 'PUT /projects/42/transfer').body, {namespace: 2});
  assert.ok(calls.every(c => !c.key.startsWith('DELETE') && c.key !== 'POST /projects'));
});

test('a same-name legacy project with a different GitHub ID is preserved without blocking a new subgroup mirror', async () => {
  const {client, calls} = harness({...base, ...missing, 'GET /projects/lizardbyte%2FSunshine': [200, {
    id: 42, path_with_namespace: 'lizardbyte/Sunshine', namespace: {id: 1}, description: 'GitHub repository ID: 123',
  }]});
  assert.equal((await client.prepare(target())).namespaceId, 2);
  assert.ok(calls.every(c => !c.key.startsWith('PUT')));
});

test('private legacy mirrors are secured and verified before any namespace transfer', async () => {
  const legacy = {id: 42, path_with_namespace: 'lizardbyte/Sunshine', namespace: {id: 1}, description: 'GitHub repository ID: 99'};
  const {client, calls} = harness({...base, ...missing,
    'GET /projects/lizardbyte%2FSunshine': [200, legacy], 'PUT /projects/42': [200, {...legacy, visibility: 'public'}]});
  await assert.rejects(client.prepare(target('SunshineStream', 'Sunshine', 99, 'private')), /privacy verification/);
  assert.ok(!calls.some(c => c.key.endsWith('/transfer')));
});

test('successful private migration verifies privacy before transfer and keeps the same GitLab ID', async () => {
  const legacy = {id: 42, path_with_namespace: 'lizardbyte/Sunshine', namespace: {id: 1}, description: 'GitHub repository ID: 99'};
  const {client, calls} = harness({...base, ...missing,
    'GET /projects/lizardbyte%2FSunshine': [200, legacy],
    'PUT /projects/42': [200, {...legacy, visibility: 'private'}],
    'PUT /projects/42/transfer': [202, legacy],
    'GET /projects/42': [200, {...legacy, namespace: {id: 2}, path_with_namespace: 'lizardbyte/sunshinestream/Sunshine'}],
  });
  assert.equal((await client.prepare(target('SunshineStream', 'Sunshine', 99, 'private'))).projectId, 42);
  assert.ok(calls.findIndex(c => c.key === 'PUT /projects/42') < calls.findIndex(c => c.key.endsWith('/transfer')));
});

test('legacy identity API failures and subgroup creation denial leave existing projects untouched', async () => {
  const legacy = {id: 42, path_with_namespace: 'lizardbyte/Sunshine', namespace: {id: 1},
    description: 'Mirror of https://github.com/LizardByte/Sunshine.git'};
  const run = harness({...base, ...missing, 'GET /projects/lizardbyte%2FSunshine': [200, legacy],
    'GET https://api.github.com/repos/LizardByte/Sunshine': [403, {}]});
  await assert.rejects(run.client.prepare(target()), /Cannot verify the existing mirror/);
  assert.ok(run.calls.every(c => c.key.startsWith('GET')));
  const denied = harness({...base, 'GET /groups/lizardbyte%2Fsunshinestream': [404, {}], 'POST /groups': [403, {}]});
  await assert.rejects(denied.client.prepare(target()), /Cannot create GitLab subgroup/);
});

test('unverifiable or conflicting destination identities, archived mirrors, and lookup failures are never overwritten', async () => {
  const project = {id: 42, path_with_namespace: 'lizardbyte/sunshinestream/Sunshine', namespace: {id: 2}};
  for (const fields of [{description: 'manual project'}, {description: 'GitHub repository ID: 123'},
    {description: 'GitHub repository ID: 99', archived: true}]) {
    const {client, calls} = harness({...base, 'GET /projects/lizardbyte%2Fsunshinestream%2FSunshine': [200, {...project, ...fields}]});
    await assert.rejects(client.prepare(target()), /identity|different GitHub repository|archived/);
    assert.ok(calls.every(c => c.key.startsWith('GET')));
  }
  const {client} = harness({...base, ...missing, 'GET /projects/lizardbyte%2FSunshine': [403, {}]});
  await assert.rejects(client.prepare(target()), /Cannot verify legacy/);
});

test('transfer errors and incomplete asynchronous transfers fail instead of creating replacement projects', async () => {
  const legacy = {id: 42, path_with_namespace: 'lizardbyte/Sunshine', namespace: {id: 1}, description: 'GitHub repository ID: 99'};
  for (const status of [403, 202]) {
    const {client} = harness({...base, ...missing,
      'GET /projects/lizardbyte%2FSunshine': [200, legacy],
      'PUT /projects/42/transfer': [status, {}], 'GET /projects/42': [200, legacy]});
    await assert.rejects(client.prepare(target()), /transfer failed|did not complete/);
  }
});

test('per-repository preparation failures are saved while other mirrors continue', async () => {
  const run = harness({...base, ...missing, 'GET /projects/lizardbyte%2FSunshine': [403, {}]});
  const results = await prepareMirrors([target(), target('LizardByte', 'New', 100)], {
    gitlabToken: 'secret', githubToken: 'secret', fetchImpl: async (url, options) => {
      if (url.endsWith('lizardbyte%2FNew')) return {status: 404, json: async () => ({})};
      return run.client.fetch(url, options);
    },
  });
  assert.match(results[0].preparationError, /Cannot verify legacy/);
  assert.equal(results[1].namespaceId, 1);
});

test('Git push remains behind preparation and private visibility verification, with large-import support intact', () => {
  const script = readFileSync('.github/scripts/mirror-gitlab.sh', 'utf8');
  assert.ok(script.indexOf('preparation_error}') < script.indexOf('Checking for the GitLab project'));
  assert.ok(script.indexOf('GitLab privacy verification failed') < script.indexOf('clone --mirror'));
  assert.match(script, /namespace_id/);
  assert.match(script, /push --mirror/);
  assert.match(script, /import\/git/);
});
