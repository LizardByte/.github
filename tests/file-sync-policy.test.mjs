import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import test from 'node:test';

const policy = JSON.parse(readFileSync('.github/file-sync.json', 'utf8'));
const organizations = JSON.parse(readFileSync('organizations.json', 'utf8'));
const schema = JSON.parse(readFileSync('repository-properties.json', 'utf8'));
const workflow = readFileSync('.github/workflows/__global-replicator.yml', 'utf8');
const compareText = (left, right) => left.localeCompare(right);

test('general files apply without profiles and each optional group has its own property selection', () => {
  const general = policy.rules.find(rule => rule.id === 'general');
  assert.equal(general.profile, undefined);
  assert.equal(general.repositories, undefined);
  assert.ok(general.files.some(file => file.source === 'renovate.json'));
  const profiles = policy.rules.filter(rule => rule.profile);
  assert.equal(profiles.length, 11);
  for (const rule of profiles) {
    assert.equal(rule.profile, rule.id);
    assert.equal(rule.repositories, undefined);
  }
  for (const file of policy.rules.flatMap(rule => rule.files).filter(file => file.source)) {
    assert.equal(file.destination ?? file.source, file.source);
    assert.equal(file.mode ?? 'sync', 'sync');
  }
});

test('cleanup remains explicit and the obsolete Docker wrapper is never a source', () => {
  const actual = policy.rules.flatMap(rule => rule.files).filter(file => file.mode === 'remove');
  assert.equal(actual.length, 33);
  assert.equal(new Set(actual.map(file => file.destination)).size, actual.length);
  assert.ok(actual.some(file => file.destination === '.github/workflows/_docker.yml'));
  assert.ok(actual.every(file => file.source === undefined));
  const sources = policy.rules.flatMap(rule => rule.files).filter(file => file.source).map(file => file.source);
  assert.ok(actual.every(file => !sources.includes(file.destination)));
});

test('configured sources exist and policy selectors use the shared organization list and property schema', () => {
  assert.equal(policy.version, 1);
  assert.ok(organizations.every(org => typeof org === 'string'));
  assert.equal(new Set(organizations).size, organizations.length);
  assert.deepEqual(organizations, organizations.toSorted(compareText));
  const profileSchema = schema.properties.find(property => property.property_name === 'workflow_profiles');
  for (const rule of policy.rules) {
    if (rule.profile) {
      assert.ok(profileSchema.allowed_values.includes(rule.profile), `Unknown profile: ${rule.profile}`);
    }
    for (const org of rule.organizations ?? []) assert.ok(organizations.includes(org));
    for (const repo of rule.repositories ?? []) assert.ok(organizations.includes(repo.split('/')[0]));
    for (const file of rule.files) {
      if (file.source) assert.ok(existsSync(file.source), `Missing source file: ${file.source}`);
    }
  }
  const sync = schema.properties.find(property => property.property_name === 'sync_mode');
  assert.equal(sync.required, true);
  assert.equal(sync.default_value, 'included');
  assert.equal(profileSchema.value_type, 'multi_select');
  assert.equal(profileSchema.required, false);
  assert.equal(profileSchema.default_value, null);
  assert.deepEqual(profileSchema.allowed_values, profileSchema.allowed_values.toSorted(compareText));
});

test('all existing community health defaults target .github without a profile or fixed organization list', () => {
  const sources = [
    'ACCESSIBILITY.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'SECURITY.md', 'SUPPORT.md',
    '.github/FUNDING.yml', '.github/VULNERABILITY_REPORT.yml', '.github/VULNERABILITY_REPORT.yaml',
    '.github/pull_request_template.md',
  ].filter(existsSync);
  for (const directory of ['.github/ISSUE_TEMPLATE', '.github/PULL_REQUEST_TEMPLATE', '.github/DISCUSSION_TEMPLATE']) {
    if (!existsSync(directory)) continue;
    sources.push(...readdirSync(directory, {recursive: true, withFileTypes: true})
      .filter(entry => entry.isFile())
      .map(entry => `${entry.parentPath}/${entry.name}`.replaceAll('\\', '/')));
  }
  assert.ok(sources.includes('.github/ISSUE_TEMPLATE/config.yml'));
  assert.ok(sources.includes('SUPPORT.md'));
  for (const source of sources) {
    const defaults = policy.rules.filter(rule => !rule.profile && rule.files.some(file => file.source === source));
    assert.equal(defaults.length, 1, `Missing unconditional community health default: ${source}`);
    assert.deepEqual(defaults[0].repository_names, ['.github']);
    assert.equal(defaults[0].repositories, undefined);
    assert.equal(defaults[0].organizations, undefined);
    const file = defaults[0].files.find(file => file.source === source);
    assert.equal(file.destination ?? source, source);
    assert.equal(file.mode ?? 'sync', 'sync');
  }
  const issueConfig = policy.rules.find(rule => rule.profile === 'custom_issues').files
    .find(file => file.source === '.github/ISSUE_TEMPLATE/config.yml');
  assert.ok(issueConfig, 'Ordinary repositories must retain profile-controlled issue configuration');
  assert.equal(issueConfig.mode ?? 'sync', 'sync');
  assert.equal(policy.include_source, false);
  assert.equal(policy.include_private, false);
  assert.equal(policy.include_archived, false);
  assert.equal(policy.include_forks, true);
});

test('all PR and master changes run, PRs preview, and production runs are serialized without cancellation', () => {
  const events = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\nconcurrency:'));
  assert.match(events, /  pull_request:/);
  assert.match(events, /  push:\r?\n    branches:\r?\n      - master/);
  assert.doesNotMatch(events, /paths:|paths-ignore:/);
  assert.match(workflow, /dry_run: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(workflow,
    /group: global-replicator-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| 'delivery' \}\}/);
  assert.doesNotMatch(events, /dry_run|repo_name/);
});

test('only the pinned new action runs and credentialed PRs retain their fork guard', () => {
  assert.match(workflow, /LizardByte\/actions\/actions\/org_sync@[a-f\d]{40}/);
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(workflow, /pull_request_target:|contents: write|pull-requests: write|continue-on-error:/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /derberg\/|topics_to_include|repositories-to-ignore/);
  assert.equal(existsSync('.github/workflows/__file-sync-preview.yml'), false);
  assert.equal(existsSync('.github/scripts/file-sync-report.mjs'), false);
  assert.doesNotMatch(workflow, /uses: actions\/upload-artifact|Save synchronization report/);
});
