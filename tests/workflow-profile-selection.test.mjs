import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const propertyRoute = 'GET /repos/{owner}/{repo}/properties/values';
const profiles = [
  ['__call-release-notifier.yml', 'release_notifications'],
  ['__call-update-flathub-repo.yml', 'flathub'],
  ['__call-update-homebrew-repo.yml', 'homebrew'],
  ['__call-update-pacman-repo.yml', 'pacman'],
  ['__call-update-winget-repo.yml', 'winget'],
];

function loadWorkflow(file) {
  const source = readFileSync(`.github/workflows/${file}`, 'utf8').replaceAll('\r\n', '\n');
  const lines = source.split('          script: |\n')[1].split('\n');
  const body = [];
  for (const line of lines) {
    if (line && !line.startsWith('            ')) break;
    body.push(line.slice(12));
  }
  assert.ok(body.length > 0, `Missing GitHub script: ${file}`);
  return {source, execute: new AsyncFunction('github', 'context', 'core', 'process', body.join('\n'))};
}

function profileValues(value) {
  return value === undefined ? [] : [{property_name: 'workflow_profiles', value}];
}

for (const [file, profile] of profiles) {
  const {source, execute} = loadWorkflow(file);
  async function run(values, error) {
    const outputs = {};
    await execute({request: async (route, coordinates) => {
      assert.equal(route, propertyRoute);
      assert.deepEqual(coordinates, {owner: 'project-org', repo: 'app'});
      if (error) throw error;
      return {data: values};
    }}, {repo: {owner: 'project-org', repo: 'app'}}, {
      info: () => {}, setOutput: (name, value) => { outputs[name] = value; },
    }, {env: {WORKFLOW_PROFILE: profile}});
    return outputs;
  }

  test(`${profile} enables a matching multi-select profile independently of file-sync exclusion`, async () => {
    const outputs = await run([...profileValues(['unrelated', profile]),
      {property_name: 'sync_mode', value: 'excluded'}]);
    assert.deepEqual(outputs, {enabled: true});
  });

  test(`${profile} skips missing, null, empty, and unrelated profile selections`, async () => {
    await Promise.all([undefined, null, [], ['other'], [`${profile}-suffix`]].map(async value => {
      assert.deepEqual(await run(profileValues(value)), {enabled: false});
    }));
  });

  test(`${profile} rejects malformed multi-select values and failed API reads`, async () => {
    await Promise.all([profile, 1, {}, [profile, null]].map(async value => {
      await assert.rejects(run(profileValues(value)), /Invalid workflow_profiles custom property/);
    }));
    await assert.rejects(run([], new Error('Property access denied')), /Property access denied/);
  });

  test(`${profile} wires the configured profile to every former topic-gated step`, () => {
    assert.ok(source.includes(`WORKFLOW_PROFILE: ${profile}`));
    assert.match(source, /id: check-profile/);
    assert.match(source, /if:.*(?:\n\s+)?steps.check-profile.outputs.enabled == 'true'/);
    assert.doesNotMatch(source, /check-label|hasTopic|getAllTopics|TOPIC:/);
    if (['release_notifications', 'flathub', 'pacman'].includes(profile)) {
      assert.match(source, /steps.check-release.outputs.isLatestRelease == 'true'/);
    }
    if (['flathub', 'homebrew', 'pacman', 'winget'].includes(profile)) {
      assert.match(source, /fromJson\(steps.download.outputs.downloaded_files\)\[0\]/);
    }
  });
}

const cpm = loadWorkflow('__update-cpm-cmake.yml');
async function cpmMatrix(repositories, valuesByName, error) {
  const outputs = {};
  const github = {
    rest: {repos: {listForOrg: {endpoint: {merge: options => options}}}},
    paginate: async options => {
      assert.deepEqual(options, {org: 'source-org'});
      return repositories;
    },
    request: async (route, {owner, repo}) => {
      assert.equal(route, propertyRoute);
      assert.equal(owner, 'source-org');
      if (error) throw error;
      return {data: profileValues(valuesByName[repo])};
    },
  };
  const matrix = await cpm.execute(github, {repo: {owner: 'source-org'}}, {
    setOutput: (name, value) => { outputs[name] = value; },
  });
  return {matrix, outputs};
}

test('CPM maintenance selects custom properties instead of public topics', async () => {
  const repos = [{name: 'selected', topics: []}, {name: 'topic-only', topics: ['cpm']}, {name: 'unset'}];
  assert.deepEqual(await cpmMatrix(repos, {selected: ['cpm', 'cpp_style'], 'topic-only': ['cpp_style']}), {
    matrix: {include: [{repo: 'selected'}]}, outputs: {'has-repositories': true},
  });
});

test('CPM maintenance reports empty selections so both matrix jobs can skip safely', async () => {
  assert.deepEqual(await cpmMatrix([{name: 'unset'}, {name: 'null'}], {null: null}), {
    matrix: {include: []}, outputs: {'has-repositories': false},
  });
  assert.deepEqual(await cpmMatrix([], {}), {
    matrix: {include: []}, outputs: {'has-repositories': false},
  });
  assert.equal(cpm.source.match(/if:.*needs.setup-matrix.outputs.has-repositories == 'true'/g).length, 2);
});

test('CPM maintenance fails for malformed selections and inaccessible properties', async () => {
  await assert.rejects(cpmMatrix([{name: 'bad', full_name: 'source-org/bad'}], {bad: 'cpm'}),
    /Invalid workflow_profiles custom property for source-org\/bad/);
  await assert.rejects(cpmMatrix([{name: 'bad'}], {}, new Error('Access denied')), /Access denied/);
});

test('workflow automation contains no repository-topic API calls or legacy profile guidance', () => {
  for (const file of readdirSync('.github/workflows').filter(file => file.endsWith('.yml'))) {
    const source = readFileSync(`.github/workflows/${file}`, 'utf8');
    assert.doesNotMatch(source, /getAllTopics|repository\.topics|repository (?:topic|label)/, file);
  }
});
