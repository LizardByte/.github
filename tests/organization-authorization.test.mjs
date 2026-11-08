import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const registryUrl = 'https://raw.githubusercontent.com/LizardByte/.github/master/organizations.json';
const workflow = readFileSync('.github/workflows/__call-organization.yml', 'utf8').replaceAll('\r\n', '\n');
const body = workflow.split('          script: |\n')[1].split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('fetch', 'context', 'core', 'AbortSignal', body);
const organizations = JSON.parse(readFileSync('organizations.json', 'utf8'));

async function authorize(owner, {registry = organizations, status = 200, error, payload = {}} = {}) {
  const outputs = {};
  const signal = {};
  const core = {info() {}, setOutput(name, value) { outputs[name] = value; }};
  const fetch = async (url, options) => {
    assert.equal(url, registryUrl);
    assert.deepEqual(options, {signal});
    if (error) throw error;
    return {ok: status === 200, status, json: async () => registry};
  };
  const AbortSignal = {timeout(milliseconds) {
    assert.equal(milliseconds, 15000);
    return signal;
  }};
  await execute(fetch, {repo: {owner}, payload}, core, AbortSignal);
  return outputs;
}

test('all registered owners, including destination orgs, are authorized without duplicating the registry', async () => {
  for (const owner of organizations) {
    assert.deepEqual(await authorize(owner), {allowed: true});
    assert.deepEqual(await authorize(owner.toUpperCase()), {allowed: true});
  }
  assert.deepEqual(await authorize('NewProject', {registry: [...organizations, 'NewProject']}), {allowed: true});
});

test('an unregistered fork or lookalike owner cannot authorize itself through event payload data', async () => {
  for (const owner of ['external-fork', 'LizardByte-extra', 'notSunshineStream']) {
    assert.deepEqual(await authorize(owner, {payload: {repository: {owner: {login: 'LizardByte'}}}}), {allowed: false});
  }
  // A fork PR against a registered base repo still runs ordinary CI under that base owner.
  assert.deepEqual(await authorize('LizardByte', {payload: {pull_request: {head: {repo: {fork: true}}}}}), {allowed: true});
});

test('missing, invalid, inaccessible, and timed-out registries fail closed', async () => {
  for (const registry of [[], null, {}, 'LizardByte', [42], ['LizardByte', 'bad/org']]) {
    await assert.rejects(authorize('LizardByte', {registry}), /Invalid organization registry/);
  }
  await assert.rejects(authorize('LizardByte', {status: 503}), /HTTP 503/);
  await assert.rejects(authorize('LizardByte', {error: new Error('Request timed out')}), /Request timed out/);
});

test('authorization requires no repository permissions or custom secrets and exports a reusable result', () => {
  assert.match(workflow, /permissions: \{\}/);
  assert.doesNotMatch(workflow, /secrets:|inputs:|Authorization:|actions\/checkout/);
  assert.match(workflow, /value: \$\{\{ jobs.check.outputs.allowed \}\}/);
  assert.match(workflow, /allowed: \$\{\{ steps.registry.outputs.allowed \}\}/);
});

const gated = [
  ['__call-release-notifier.yml', 'update-blog'],
  ['__call-top-issues.yml', 'top-issues'],
  ['__call-update-changelog.yml', 'update-changelog'],
  ['__call-update-docs.yml', 'update-docs'],
  ['__call-update-flathub-repo.yml', 'update-flathub-repo'],
  ['__call-update-homebrew-repo.yml', 'update-homebrew-repo'],
  ['__call-update-npm.yml', 'publish-npm'],
  ['__call-update-pacman-repo.yml', 'update-pacman-repo'],
  ['__call-update-winget-repo.yml', 'update-winget-repo'],
];

for (const [file, job] of gated) {
  test(`${file} checks the trusted registry before any provider job`, () => {
    const source = readFileSync(`.github/workflows/${file}`, 'utf8');
    assert.match(source, /organization:\s+uses: \.\/.github\/workflows\/__call-organization.yml/);
    const start = source.indexOf(`  ${job}:`);
    assert.notEqual(start, -1);
    const jobSource = source.slice(start);
    assert.match(jobSource, /needs: organization/);
    assert.match(jobSource, /if:[\s>\-]*needs.organization.outputs.allowed == 'true'/);
    assert.doesNotMatch(source, /if:[^\n]*repository_owner == 'LizardByte'/);
  });
}

test('consumer wrappers delegate owner authorization while retaining event and controller-only guards', () => {
  for (const [file] of gated) {
    const wrapper = file.replace('__call-', '_');
    const source = readFileSync(`.github/workflows/${wrapper}`, 'utf8');
    assert.doesNotMatch(source, /repository_owner == 'LizardByte'/);
  }
  const changelog = readFileSync('.github/workflows/_update-changelog.yml', 'utf8');
  assert.match(changelog, /!github.event.release.prerelease && !github.event.release.draft/);
  const controller = readFileSync('.github/workflows/__global-replicator.yml', 'utf8');
  assert.match(controller, /github.repository == 'LizardByte\/\.github'/);
});

test('Node coverage and releases require registration while fork test builds remain enabled', () => {
  const source = readFileSync('.github/workflows/__call-ci-node.yml', 'utf8');
  assert.match(source, /needs.organization.outputs.allowed == 'true' &&\s+steps.setup_release.outputs.publish_release == 'true'/);
  assert.equal(source.match(/needs.organization.outputs.allowed == 'true'/g).length, 3);
  const build = source.slice(source.indexOf('  build:'), source.indexOf('  release:'));
  assert.doesNotMatch(build.slice(0, build.indexOf('    steps:')), /if:/);
  assert.match(build, /- organization/);
});

test('Docker publishing uses an authorized plan flag rather than a caller-controlled input', () => {
  const source = readFileSync('.github/workflows/__call-docker.yml', 'utf8');
  assert.match(source, /publish_release: \$\{\{ needs.organization.outputs.allowed == 'true' && inputs.publish_release == 'true' \}\}/);
  const builds = source.slice(source.indexOf('  docker_bake:'));
  assert.doesNotMatch(builds, /inputs.publish_release/);
  assert.match(builds, /PUBLISH_RELEASE: \$\{\{ needs.check_dockerfiles.outputs.publish_release \}\}/);
});

test('shared publishing destinations and installed package identities stay under LizardByte', () => {
  const expected = [
    ['__call-release-notifier.yml', 'BLOG_REPO: LizardByte/LizardByte.github.io'],
    ['__call-update-pacman-repo.yml', 'PACMAN_REPO: LizardByte/pacman-repo'],
    ['__call-update-homebrew-repo.yml', 'org_homebrew_repo: LizardByte/homebrew-homebrew'],
    ['__call-update-winget-repo.yml', 'LizardByte.${{ github.event.repository.name }}'],
    ['__call-update-npm.yml', "scope: '@lizardbyte'"],
  ];
  for (const [file, value] of expected) {
    assert.ok(readFileSync(`.github/workflows/${file}`, 'utf8').includes(value), file);
  }
  const winget = readFileSync('.github/workflows/__call-update-winget-repo.yml', 'utf8');
  assert.match(winget, /WINGET_FORK: \$\{\{ vars.GH_BOT_NAME \}\}\/winget-pkgs/);
});

test('container names retain the existing namespace independently of the repository owner', () => {
  const source = readFileSync('.github/workflows/__call-docker.yml', 'utf8');
  const step = source.slice(source.indexOf('      - name: Set image name'), source.indexOf('    outputs:'));
  assert.match(step, /IMAGE_NAMESPACE: \$\{\{ inputs.image_namespace \|\| 'LizardByte' \}\}/);
  assert.match(step, /REPOSITORY_NAME: \$\{\{ github.event.repository.name \}\}/);
  assert.match(step, /printf '%s\/%s' "\$\{IMAGE_NAMESPACE\}" "\$\{REPOSITORY_NAME\}"/);
  assert.doesNotMatch(step, /github.repository_owner|github.repository \}\}/);
});

test('cross-org npm publishing receives a bot token while same-org publishing retains GITHUB_TOKEN', () => {
  const source = readFileSync('.github/workflows/__call-update-npm.yml', 'utf8');
  assert.match(source, /GH_TOKEN: \$\{\{ github.repository_owner == 'LizardByte' && secrets.GITHUB_TOKEN \|\| secrets.GH_TOKEN \}\}/);
  assert.match(source, /if \[\[ -z "\$\{GH_TOKEN\}" \]\]; then/);
  const wrapper = readFileSync('.github/workflows/_update-npm.yml', 'utf8');
  assert.match(wrapper, /GH_TOKEN: \$\{\{ secrets.GH_BOT_TOKEN \}\}/);
});
