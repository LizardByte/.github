import {readFileSync} from 'node:fs';

import {forEachSequential} from './async-iteration.mjs';

/** Read and validate the shared organization registry, without maintaining another org list. */
export function readOrganizations(path = 'organizations.json') {
  const organizations = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(organizations) || !organizations.length || organizations.some(name =>
    typeof name !== 'string' || !/^[a-z\d][a-z\d-]*$/i.test(name)) ||
    new Set(organizations.map(name => name.toLowerCase())).size !== organizations.length) {
    throw new Error('Invalid organization registry');
  }
  return organizations;
}

/** Discover canonical repository identities once per org, retaining caller-specific eligibility rules. */
export async function discoverRepositories(github, organizations, {
  includeArchived = false, includeForks = true, includePrivate = false,
} = {}) {
  const repositories = new Map();
  await forEachSequential(organizations, async organization => {
    const options = github.rest.repos.listForOrg.endpoint.merge({org: organization, per_page: 100});
    const repos = await github.paginate(options);
    for (const repo of repos) {
      if (!Number.isSafeInteger(repo.id) || repo.id <= 0 ||
        repo.owner?.login?.toLowerCase() !== organization.toLowerCase() ||
        !/^[\w.-]+$/.test(repo.name) || ['.', '..'].includes(repo.name) ||
        repo.full_name !== `${repo.owner.login}/${repo.name}`) {
        throw new Error(`Invalid repository identity returned for ${organization}`);
      }
      const previous = repositories.get(repo.id);
      if (previous && previous.full_name !== repo.full_name) {
        throw new Error('Repository ownership changed during discovery; retry the workflow');
      }
      if ((!includeArchived && repo.archived) || (!includeForks && repo.fork) ||
        (!includePrivate && repo.visibility !== 'public')) continue;
      repositories.set(repo.id, repo);
    }
  });
  return [...repositories.values()];
}

/** Build public maintenance matrices; private mirrors are handled within the single mirror job. */
export async function maintenanceMatrix(github, organizations, {profile, includeForks = true, issuesOnly = false} = {}) {
  const repos = await discoverRepositories(github, organizations, {includeForks});
  const include = [];
  await forEachSequential(repos, async repo => {
    if (issuesOnly && repo.has_issues === false) return;
    if (profile) {
      const {data: values} = await github.request('GET /repos/{owner}/{repo}/properties/values', {
        owner: repo.owner.login, repo: repo.name,
      });
      const profiles = values.find(property => property.property_name === 'workflow_profiles')?.value ?? [];
      if (!Array.isArray(profiles) || !profiles.every(value => typeof value === 'string')) {
        throw new Error(`Invalid workflow_profiles custom property for ${repo.full_name}`);
      }
      if (!profiles.includes(profile)) return;
    }
    include.push({owner: repo.owner.login, repo: repo.name, full_name: repo.full_name});
  });
  return {include};
}

/** Resolve a qualified name, or retain a short-name entry point when it is unambiguous. */
export function resolveRepository(repositories, selector) {
  const normalized = selector.trim().toLowerCase();
  const matches = repositories.filter(repo =>
    (normalized.includes('/') ? repo.full_name : repo.name).toLowerCase() === normalized);
  if (matches.length !== 1) {
    throw new Error('Repository must identify exactly one eligible repository in organizations.json; use owner/repository');
  }
  return matches[0];
}

/** Keep shared actions on master for every registered org while pinning third-party actions. */
export function pinactConfiguration(organizations) {
  return JSON.stringify({
    version: 3,
    ignore_actions: [
      ...organizations.map(name => ({name: `${name}/.*`, ref: 'master'})),
      {name: 'Homebrew/actions/.*', ref: 'main'},
    ],
    separator: '  # ',
  }, null, 2);
}
