import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const policy = JSON.parse(readFileSync('.github/org-sync.json', 'utf8'));
const organizations = JSON.parse(readFileSync('organizations.json', 'utf8'));
const workflow = readFileSync('.github/workflows/__global-replicator.yml', 'utf8');
const audit = JSON.parse(readFileSync('tests/fixtures/org-sync-consumers.json', 'utf8'));
const compareText = (left, right) => left.localeCompare(right);

test('the shared policy administers destination orgs while preserving project identities', () => {
  assert.equal(policy.source_organization, 'LizardByte');
  assert.deepEqual(policy.organizations, organizations.filter(org => org !== policy.source_organization));
  assert.ok(!policy.organizations.includes(policy.source_organization));
  assert.deepEqual(policy.settings.from_source, policy.settings.from_source.toSorted(compareText));
  for (const field of ['company', 'name', 'description', 'blog']) assert.ok(!policy.settings.from_source.includes(field));
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

test('credential distribution grants access only to audited active consumers, including future transferred repos', () => {
  const identities = policy.secrets.flatMap(entry => entry.organizations.map(org => `${org}/${entry.kind}/${entry.name}`));
  assert.equal(new Set(identities).size, identities.length);
  for (const entry of [...policy.variables, ...policy.secrets]) {
    assert.equal(entry.visibility, 'selected');
    assert.equal(entry.missing_repositories, 'defer');
    assert.ok(!entry.name.startsWith('GITHUB_'));
    assert.equal(entry.organizations.length, 1);
    assert.ok(entry.organizations.every(org => policy.organizations.includes(org)));
    assert.ok(entry.repository_names.length > 0);
    assert.ok(!entry.repository_names.includes('.github'));
  }
  const actual = [...policy.variables.map(entry => ({...entry, kind: 'variable'})), ...policy.secrets]
    .flatMap(entry => entry.organizations.flatMap(org => entry.repository_names.map(repo => `${org}/${repo}:${entry.kind}:${entry.name}`)));
  const expected = audit.repositories.flatMap(repo => [
    ...repo.variables.map(name => `${repo.repository}:variable:${name}`),
    ...repo.actions_secrets.map(name => `${repo.repository}:actions:${name}`),
    ...repo.dependabot_secrets.map(name => `${repo.repository}:dependabot:${name}`),
  ]);
  assert.deepEqual(actual.toSorted(compareText), expected.toSorted(compareText));
  for (const repo of audit.archived_repositories) assert.ok(actual.every(value => !value.startsWith(`${repo}:`)));
  for (const repo of audit.repositories) {
    assert.match(repo.source_commit, /^[a-f\d]{40}$/);
    assert.ok(!repo.repository.startsWith('LizardByte-infrastructure/'));
  }
});

test('variables are copied by name and secrets use explicit supplied bindings, with no committed plaintext', () => {
  const bindings = workflow.replaceAll(/: >-\r?\n\s+/g, ': ');
  for (const entry of policy.variables) {
    assert.equal(entry.from_source, entry.name);
    assert.equal(entry.value, undefined);
  }
  for (const entry of policy.secrets) {
    const expectedBinding = entry.name === 'CODECOV_TOKEN' ? `ORG_SYNC_CODECOV_${entry.organizations[0].toUpperCase()}` : entry.name;
    assert.equal(entry.value_env, expectedBinding);
    assert.equal(entry.value, undefined);
    assert.equal(entry.from_source, undefined);
    assert.equal(entry.value_key, undefined);
    assert.ok(bindings.includes(`${entry.value_env}: ` + '${{ secrets.' + entry.value_env + ' }}'));
  }
  assert.ok(!policy.secrets.some(entry => entry.name === 'ORG_SYNC_ADMIN_TOKEN'));
});

test('controller-only, social, and unused credentials are absent from both the policy and its supplied bindings', () => {
  const excluded = ['AUR_SSH_PUBLIC_KEY', 'AUR_SSH_PRIVATE_KEY', 'BUFFER_X_CHANNEL_ID', 'BUFFER_API_KEY', 'CLA_GIST_ID',
    'COLOR_HEX_GREEN', 'COLOR_HEX_RED', 'DISCORD_GITHUB_STATUS_CHANNEL_ID', 'DISCORD_REDDIT_CHANNEL_ID',
    'DISCORD_SPONSORS_CHANNEL_ID', 'DISCORD_USERNAME', 'DISCORD_RELEASE_WEBHOOK', 'DISCORD_WEBHOOKS', 'DISCORD_INVITE',
    'FACEBOOK_ACCESS_TOKEN', 'FACEBOOK_PAGE_ID', 'GH_PAT', 'GITLAB_SSH_PRIVATE_KEY', 'GITLAB_TOKEN',
    'GITLAB_TOKEN_ROTATOR_CLIENT_ID', 'GITLAB_TOKEN_ROTATOR_PRIVATE_KEY', 'GRAVATAR_EMAIL', 'ORG_LOGO_URL',
    'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_PASSWORD', 'REDDIT_USERNAME', 'REDDIT_SUBREDDIT', 'REDDIT_FLAIR_ID'];
  for (const name of excluded) {
    assert.ok(![...policy.variables, ...policy.secrets].some(entry => entry.name === name));
    assert.doesNotMatch(workflow, new RegExp(`^          ${name}:`, 'm'));
  }
  assert.doesNotMatch(workflow, /^          CODECOV_TOKEN:/m);
});

test('one action invocation handles schemas and policy while exact-repository dispatch stays file-only', () => {
  assert.equal([...workflow.matchAll(/uses: LizardByte\/actions\/actions\/org_sync@/g)].length, 1);
  assert.equal([...workflow.slice(workflow.indexOf('\njobs:')).matchAll(/^  [\w-]+:\r?$/gm)].length, 1);
  assert.ok(workflow.includes("admin_config: ${{ inputs.repository == '' && '.github/org-sync.json' || '' }}"));
  assert.ok(workflow.includes("properties_file: ${{ inputs.repository == '' && 'repository-properties.json' || '' }}"));
  assert.ok(workflow.includes('admin_token: ${{ secrets.ORG_SYNC_ADMIN_TOKEN || secrets.GH_BOT_TOKEN }}'));
  assert.ok(workflow.includes("dry_run: ${{ github.event_name == 'pull_request' }}"));
  assert.doesNotMatch(workflow, /toJSON\(secrets\)|toJson\(secrets\)|gh api|hooks\/.*\/pings/);
});
