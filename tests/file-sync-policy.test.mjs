import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import test from 'node:test';

const policy = JSON.parse(readFileSync('.github/file-sync.json', 'utf8'));
const organizations = JSON.parse(readFileSync('organizations.json', 'utf8'));
const schema = JSON.parse(readFileSync('repository-properties.json', 'utf8'));
const legacy = readFileSync('.github/workflows/__global-replicator.yml', 'utf8');
const preview = readFileSync('.github/workflows/__file-sync-preview.yml', 'utf8');
const compareText = (left, right) => left.localeCompare(right);
const profiles = new Map([
  ['', undefined], ['rtd', 'docs'], ['flathub-pkg', 'flathub'], ['homebrew-pkg', 'homebrew'],
  ['pacman-pkg', 'pacman'], ['winget-pkg', 'winget'], ['nodejs', 'node_ci'], ['npm-pkg', 'npm'],
  ['python', 'python_style'], ['c,cpp', 'cpp_style'], ['replicator-custom-issues', 'custom_issues'],
  ['replicator-release-notifications', 'release_notifications'],
]);

test('file policy preserves every active legacy file group and its profile selection', () => {
  const groups = [...legacy.matchAll(/patterns_to_include: >-\r?\n([\s\S]*?)\r?\n\s+topics_to_include: '([^']*)'/g)];
  assert.equal(groups.length, 12);
  for (const [, sourceList, topics] of groups) {
    assert.ok(profiles.has(topics), `Unmapped legacy selector: ${topics}`);
    const profile = profiles.get(topics);
    const rules = policy.rules.filter(rule => rule.profile === profile && !rule.repositories);
    for (const source of sourceList.trim().split(/,\s*/)) {
      const mapping = rules.flatMap(rule => rule.files).find(file => file.source === source);
      assert.ok(mapping, `Missing legacy source: ${source}`);
      assert.equal(mapping.destination ?? mapping.source, source);
      assert.equal(mapping.mode ?? 'sync', 'sync');
    }
  }
});

test('cleanup remains explicit and the obsolete Docker wrapper is never a source', () => {
  const cleanup = legacy.match(/patterns_to_remove: >-\r?\n([\s\S]*?)\r?\n\s+topics_to_include:/)[1];
  const expected = cleanup.trim().split(/,\s*/);
  const actual = policy.rules.flatMap(rule => rule.files).filter(file => file.mode === 'remove');
  assert.deepEqual(actual.map(file => file.destination).toSorted(compareText), expected.toSorted(compareText));
  assert.ok(actual.some(file => file.destination === '.github/workflows/_docker.yml'));
  assert.ok(actual.every(file => file.source === undefined));
  assert.ok(policy.rules.flatMap(rule => rule.files).every(file => file.source !== '.github/workflows/_docker.yml'));
  assert.doesNotMatch(legacy, /name: Replicating files \(docker\)/);
});

test('configured sources exist and policy selectors use the shared organization list and property schema', () => {
  assert.equal(policy.version, 1);
  assert.ok(organizations.every(org => typeof org === 'string'));
  assert.equal(new Set(organizations).size, organizations.length);
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

test('PR templates target only exact organization .github repositories', () => {
  const templates = policy.rules.filter(rule => rule.files.some(file => file.source === '.github/pull_request_template.md'));
  assert.equal(templates.length, 1);
  assert.ok(templates[0].repositories.length > 0);
  assert.ok(templates[0].repositories.every(repo => repo.endsWith('/.github')));
  assert.equal(templates[0].profile, undefined);
  assert.equal(policy.include_source, false);
  assert.equal(policy.include_private, false);
  assert.equal(policy.include_archived, false);
  assert.equal(policy.include_forks, true);
});

test('preview cannot enable delivery and the legacy writer stays enabled', () => {
  const dispatch = preview.slice(preview.indexOf('  workflow_dispatch:'), preview.indexOf('\nconcurrency:'));
  assert.doesNotMatch(dispatch, /dry_run|type: boolean/);
  assert.match(preview, /dry_run: 'true'/);
  assert.doesNotMatch(preview, /dry_run:.*\$\{\{/);
  assert.match(preview, /LizardByte\/actions\/actions\/org_sync@d5471304498e623f670db93062e3769a5bf14192/);
  assert.match(preview, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(preview, /pull_request_target:|contents: write|pull-requests: write|continue-on-error:/);
  assert.match(legacy, /  push:\r?\n    branches:\r?\n      - master/);
  assert.match(legacy, /  workflow_dispatch:/);
  assert.match(legacy, /uses: derberg\/manage-files-in-multiple-repositories@/);
});
