import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

import {discoverRepositories, maintenanceMatrix, pinactConfiguration, readOrganizations,
  resolveRepository} from '../.github/scripts/organization-repositories.mjs';

const organizations = ['Source', 'Project'];
function repo(owner, name, id, extra = {}) {
  return {id, owner: {login: owner}, name, full_name: `${owner}/${name}`, visibility: 'public', ...extra};
}
function client(repos, values = {}) {
  const calls = [];
  return {calls, github: {
    rest: {repos: {listForOrg: {endpoint: {merge: options => options}}}},
    paginate: async options => { calls.push(options); return repos.filter(r => r.owner.login === options.org); },
    request: async (route, coordinates) => {
      assert.equal(route, 'GET /repos/{owner}/{repo}/properties/values');
      const value = values[`${coordinates.owner}/${coordinates.repo}`];
      if (value instanceof Error) throw value;
      return {data: value === undefined ? [] : [{property_name: 'workflow_profiles', value}]};
    },
  }};
}

test('registry rejects malformed and duplicate names without duplicating its organization list', () => {
  const directory = mkdtempSync(join(tmpdir(), 'organization-registry-'));
  const path = join(directory, 'organizations.json');
  try {
    for (const value of [[], {}, null, ['bad/org'], [7], ['Source', 'source']]) {
      writeFileSync(path, JSON.stringify(value));
      assert.throws(() => readOrganizations(path), /Invalid organization registry/);
    }
    writeFileSync(path, JSON.stringify(organizations));
    assert.deepEqual(readOrganizations(path), organizations);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('cross-org discovery retains same-name projects and filters private/archived repos from public matrices', async () => {
  const repos = [repo('Source', 'shared', 1), repo('Project', 'shared', 2),
    repo('Source', 'private', 3, {visibility: 'private'}), repo('Project', 'archived', 4, {archived: true}),
    repo('Project', 'fork', 5, {fork: true})];
  const {github, calls} = client(repos);
  assert.deepEqual((await discoverRepositories(github, organizations)).map(r => r.id), [1, 2, 5]);
  assert.deepEqual(calls, organizations.map(org => ({org, per_page: 100})));
  assert.equal((await discoverRepositories(github, organizations, {includePrivate: true, includeArchived: true})).length, 5);
  assert.deepEqual((await discoverRepositories(github, organizations, {includeForks: false})).map(r => r.id), [1, 2]);
});

test('discovery fails on API errors, invalid identity, or conflicting repository IDs', async () => {
  const {github} = client([repo('Source', 'a', 1), repo('Project', 'b', 1)]);
  await assert.rejects(discoverRepositories(github, organizations), /ownership changed/);
  const bad = client([repo('Source', 'a', 1, {full_name: 'Other/a'})]);
  await assert.rejects(discoverRepositories(bad.github, organizations), /Invalid repository identity/);
  github.paginate = async () => { throw new Error('Access denied'); };
  await assert.rejects(discoverRepositories(github, organizations), /Access denied/);
});

test('CPM selection reads custom properties from each actual owner, independently of topics and sync_mode', async () => {
  const {github} = client([repo('Source', 'a', 1), repo('Project', 'b', 2, {topics: ['cpm']})], {
    'Source/a': ['cpm', 'cpp_style'], 'Project/b': ['cpp_style'],
  });
  assert.deepEqual(await maintenanceMatrix(github, organizations, {profile: 'cpm'}), {
    include: [{owner: 'Source', repo: 'a', full_name: 'Source/a'}],
  });
  assert.deepEqual(await maintenanceMatrix(github, organizations, {profile: 'unset'}), {include: []});
});

test('CPM rejects malformed properties and inaccessible property reads', async () => {
  for (const value of ['cpm', [null], new Error('Property access denied')]) {
    const {github} = client([repo('Project', 'a', 1)], {'Project/a': value});
    await assert.rejects(maintenanceMatrix(github, organizations, {profile: 'cpm'}),
      /Invalid workflow_profiles|Property access denied/);
  }
});

test('license and stale matrices retain fork and issue eligibility rules and handle empty organizations', async () => {
  const {github} = client([repo('Source', 'fork', 1, {fork: true}), repo('Project', 'no-issues', 2, {has_issues: false})]);
  assert.equal((await maintenanceMatrix(github, organizations, {includeForks: false})).include[0].owner, 'Project');
  assert.equal((await maintenanceMatrix(github, organizations, {issuesOnly: true})).include[0].repo, 'fork');
  assert.deepEqual(await maintenanceMatrix(client([]).github, organizations), {include: []});
});

test('short-name entry points follow transfers and reject ambiguous or out-of-registry targets', () => {
  const repos = [repo('Source', 'same', 1), repo('Project', 'same', 2), repo('Project', 'Sunshine', 3)];
  assert.equal(resolveRepository(repos, 'sunshine').full_name, 'Project/Sunshine');
  assert.equal(resolveRepository(repos, 'PROJECT/same').id, 2);
  for (const value of ['same', 'Other/Sunshine', '', '../Sunshine']) {
    assert.throws(() => resolveRepository(repos, value), /exactly one eligible repository/);
  }
  assert.equal(JSON.parse(pinactConfiguration([...organizations, 'FutureOrg'])).ignore_actions[2].name, 'FutureOrg/.*');
});

test('controller workflows wire qualified targets, bot credentials, and safe empty matrices', () => {
  for (const file of ['__issues-stale.yml', '__update-cpm-cmake.yml', '__update_license_years.yml']) {
    const source = readFileSync(`.github/workflows/${file}`, 'utf8');
    assert.match(source, /maintenanceMatrix\(github, readOrganizations\(\)/);
    assert.match(source, /github-token: \$\{\{ secrets.GH_BOT_TOKEN \}\}/);
    assert.match(source, /has-repositories == 'true'/);
    assert.doesNotMatch(source, /repository: \$\{\{ github.repository_owner \}\}/);
  }
  assert.match(readFileSync('.github/workflows/__issues-stale.yml', 'utf8'), /repo-owner: \$\{\{ matrix.owner \}\}/);
  const buildDeps = readFileSync('.github/workflows/__update-build-deps.yml', 'utf8');
  assert.match(buildDeps, /resolveRepository\(repos, process.env.REPOSITORY\)/);
  assert.match(buildDeps, /const options = \{owner: 'LizardByte', repo: 'build-deps'\}/);
});
