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

test('CPM maintenance delegates profile and organization selection to the shared discovery helper', () => {
  const source = readFileSync('.github/workflows/__update-cpm-cmake.yml', 'utf8');
  assert.match(source, /maintenanceMatrix\(github, readOrganizations\(\), \{profile: 'cpm'\}\)/);
  assert.equal(source.match(/if:.*needs.setup-matrix.outputs.has-repositories == 'true'/g).length, 2);
});

test('workflow automation contains no repository-topic API calls or legacy profile guidance', () => {
  for (const file of readdirSync('.github/workflows').filter(file => file.endsWith('.yml'))) {
    const source = readFileSync(`.github/workflows/${file}`, 'utf8');
    assert.doesNotMatch(source, /getAllTopics|repository\.topics|repository (?:topic|label)/, file);
  }
});
