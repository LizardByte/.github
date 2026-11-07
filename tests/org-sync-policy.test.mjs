import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const policy = JSON.parse(readFileSync('.github/org-sync.json', 'utf8'));
const organizations = JSON.parse(readFileSync('organizations.json', 'utf8'));
const workflow = readFileSync('.github/workflows/__global-replicator.yml', 'utf8');
const compareText = (left, right) => left.localeCompare(right);

test('the shared policy administers destination orgs while preserving project identities', () => {
  assert.equal(policy.source_organization, 'LizardByte');
  assert.deepEqual(policy.organizations, organizations.filter(org => org !== policy.source_organization));
  assert.ok(!policy.organizations.includes(policy.source_organization));
  assert.deepEqual(policy.settings.from_source, policy.settings.from_source.toSorted(compareText));
  for (const field of ['name', 'description', 'blog']) assert.ok(!policy.settings.from_source.includes(field));
  for (const field of ['location', 'twitter_username', 'default_repository_permission', 'members_can_create_repositories']) {
    assert.ok(policy.settings.from_source.includes(field));
  }
  assert.equal(policy.settings.values, undefined);
});

test('active Actions policies, additive blocking, and both security default scopes follow the source', () => {
  assert.deepEqual(policy.actions.from_source, ['permissions', 'retention', 'workflow']);
  assert.deepEqual(policy.blocked_users, {from_source: true, remove_extra: false});
  assert.deepEqual(policy.security_configurations.map(config => config.source_name), ['private/internal repositories', 'strict']);
  assert.ok(policy.security_configurations.every(config => config.copy_default === true));
});

test('Discord hooks are selected at runtime without credential URLs or unrelated integrations', () => {
  assert.deepEqual(policy.webhooks, [{id: 'discord', source_url_prefix: 'https://discord.com/api/webhooks/', unsigned: true}]);
  assert.doesNotMatch(JSON.stringify(policy), /discord\.com\/api\/webhooks\/[\w-]/);
  assert.ok(policy.webhooks.every(entry => entry.url === undefined && entry.source_url === undefined));
  assert.doesNotMatch(JSON.stringify(policy.webhooks), /cla/i);
});

test('credential distribution retains explicit destinations, selected access, and unique identities', () => {
  const identities = policy.secrets.map(entry => `${entry.kind}/${entry.name}`);
  assert.equal(new Set(identities).size, identities.length);
  for (const entry of [...policy.variables, ...policy.secrets]) {
    assert.ok(['all', 'selected'].includes(entry.visibility));
    assert.ok(!entry.name.startsWith('GITHUB_'));
    assert.ok((entry.organizations ?? policy.organizations).every(org => policy.organizations.includes(org)));
    if (entry.visibility === 'selected') {
      assert.deepEqual(entry.repository_names, ['.github']);
      assert.deepEqual(entry.organizations, ['LizardByte-infrastructure', 'SunshineStream']);
    } else assert.equal(entry.repository_names, undefined);
  }
});

test('variables are copied by name and secrets use explicit supplied bindings, with no committed plaintext', () => {
  const bindings = workflow.replaceAll(/: >-\r?\n\s+/g, ': ');
  for (const entry of policy.variables) {
    assert.equal(entry.from_source, entry.name);
    assert.equal(entry.value, undefined);
  }
  for (const entry of policy.secrets) {
    assert.equal(entry.value_env, entry.name);
    assert.equal(entry.value, undefined);
    assert.equal(entry.from_source, undefined);
    assert.equal(entry.value_key, undefined);
    const context = ['GH_BOT_NAME', 'REDDIT_USERNAME'].includes(entry.name) ? 'vars' : 'secrets';
    assert.ok(bindings.includes(`${entry.value_env}: ` + '${{ ' + `${context}.${entry.name}` + ' }}'));
  }
  assert.ok(!policy.secrets.some(entry => entry.name === 'ORG_SYNC_ADMIN_TOKEN'));
});

test('one action invocation handles schemas and policy while exact-repository dispatch stays file-only', () => {
  assert.equal([...workflow.matchAll(/uses: LizardByte\/actions\/actions\/org_sync@/g)].length, 1);
  assert.equal([...workflow.slice(workflow.indexOf('\njobs:')).matchAll(/^  [\w-]+:\r?$/gm)].length, 1);
  assert.ok(workflow.includes("admin_config: ${{ inputs.repository == '' && '.github/org-sync.json' || '' }}"));
  assert.ok(workflow.includes("properties_file: ${{ inputs.repository == '' && 'repository-properties.json' || '' }}"));
  assert.ok(workflow.includes('admin_token: ${{ secrets.ORG_SYNC_ADMIN_TOKEN || secrets.GH_PAT || secrets.GH_BOT_TOKEN }}'));
  assert.ok(workflow.includes("dry_run: ${{ github.event_name == 'pull_request' }}"));
  assert.doesNotMatch(workflow, /toJSON\(secrets\)|toJson\(secrets\)|gh api|hooks\/.*\/pings/);
});
