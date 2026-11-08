import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

import {forEachSequential} from './async-iteration.mjs';

/** Apply qualified mirror exclusions and omit temporary security-advisory forks. */
export function mirrorRepositories(repos, ignored, rootGroup, sourceOrganization) {
  if (!Array.isArray(ignored) || !ignored.every(value =>
    typeof value === 'string' && /^[\w-]+\/[\w.-]+$/.test(value))) {
    throw new Error('Mirror exclusions must be qualified owner/repository names');
  }
  const exclusions = new Set(ignored.map(value => value.toLowerCase()));
  const segment = '[23456789cfghjmpqrvwx]{4}';
  const advisoryFork = new RegExp(`-ghsa-${segment}-${segment}-${segment}$`, 'i');
  return repos.filter(repo => !exclusions.has(repo.full_name.toLowerCase()) && !advisoryFork.test(repo.name))
    .map(repo => mirrorTarget(repo, rootGroup, sourceOrganization));
}

/** Keep existing LizardByte paths; isolate other GitHub owners in matching GitLab subgroups. */
export function mirrorTarget(repo, rootGroup, sourceOrganization) {
  if (repo.clone_url !== `https://github.com/${repo.full_name}.git` ||
    !Number.isSafeInteger(repo.size) || repo.size < 0) throw new Error('Invalid mirror source metadata');
  const prefixNames = {'.': 'dot-', '-': 'dash-', '_': 'underscore-'};
  const lowerName = repo.name.toLowerCase();
  let path = lowerName.replace(/^[._-]+/, prefix => [...prefix].map(char => prefixNames[char]).join(''))
    .replace(/[^a-z0-9_.-]+/g, '-').replace(/[._-]{2,}/g, '-').replace(/[._-]$/, '');
  if (path.endsWith('.git') || path.endsWith('.atom')) path += '-repo';
  if (!path) path = 'repository';
  const transformed = path !== lowerName;
  const targetGroup = repo.owner.login.toLowerCase() === sourceOrganization.toLowerCase()
    ? rootGroup : `${rootGroup}/${repo.owner.login.toLowerCase()}`;
  return {
    id: repo.id, name: repo.full_name, cloneUrl: repo.clone_url, sizeKiB: repo.size,
    targetName: transformed ? path : repo.name,
    targetPath: transformed ? `${path}-${repo.id}` : repo.name,
    targetGroup, targetVisibility: repo.visibility === 'public' ? 'public' : 'private',
    description: `Mirror of ${repo.clone_url}\nGitHub repository ID: ${repo.id}`,
  };
}

/** Reconcile namespaces and transfer verified legacy mirrors without deleting or recreating projects. */
export class GitLabMirrors {
  constructor({gitlabToken, githubToken, rootGroup = 'lizardbyte', fetchImpl = fetch,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))}) {
    this.gitlabToken = gitlabToken;
    this.githubToken = githubToken;
    this.rootGroup = rootGroup;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.groups = new Map();
  }

  /** Make an authenticated request without following a renamed project's redirect or logging credentials. */
  async request(method, path, body) {
    const response = await this.fetch(`https://gitlab.com/api/v4${path}`, {
      method, redirect: 'manual', signal: AbortSignal.timeout(60000),
      headers: {'PRIVATE-TOKEN': this.gitlabToken, 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    const data = await response.json();
    return {status: response.status, data};
  }

  /** Read the root or create one direct subgroup; never attempt unsupported top-level group creation. */
  async group(path, displayName) {
    if (this.groups.has(path)) return this.groups.get(path);
    let result = await this.request('GET', `/groups/${encodeURIComponent(path)}`);
    if (result.status === 404 && path !== this.rootGroup) {
      result = await this.createSubgroup(path, displayName);
    } else if (result.status !== 200) {
      throw new Error(`Cannot read GitLab group (HTTP ${result.status})`);
    }
    if (!Number.isSafeInteger(result.data.id) || result.data.full_path !== path ||
      !['public', 'internal', 'private'].includes(result.data.visibility)) {
      throw new Error('GitLab group verification failed');
    }
    if (path !== this.rootGroup) {
      const parent = await this.group(this.rootGroup);
      if (result.data.parent_id !== parent.id) throw new Error('GitLab subgroup parent verification failed');
    }
    this.groups.set(path, result.data);
    return result.data;
  }

  /** Create a direct child and tolerate another owner creating the same subgroup concurrently. */
  async createSubgroup(path, displayName) {
    const parent = await this.group(this.rootGroup);
    const name = path.slice(this.rootGroup.length + 1);
    if (!/^[a-z\d][a-z\d-]*$/i.test(name)) throw new Error('Invalid GitLab subgroup path');
    let result = await this.request('POST', '/groups', {
      parent_id: parent.id, name: displayName ?? name, path: name,
      visibility: parent.visibility, auto_devops_enabled: false,
    });
    if ([400, 409].includes(result.status)) result = await this.request('GET', `/groups/${encodeURIComponent(path)}`);
    if (![200, 201].includes(result.status)) throw new Error(`Cannot create GitLab subgroup (HTTP ${result.status})`);
    return result;
  }

  /** Verify provenance by immutable GitHub ID, resolving legacy clone URLs through GitHub redirects. */
  async verifyIdentity(project, repo, allowDifferent = false) {
    if (!Number.isSafeInteger(project.id) || project.id <= 0) throw new Error('Invalid GitLab project identity');
    const description = project.description ?? '';
    const marker = /^GitHub repository ID: (\d+)$/m.exec(description);
    if (marker) {
      if (Number(marker[1]) === repo.id) return true;
      if (allowDifferent) return false;
      throw new Error('GitLab mirror belongs to a different GitHub repository');
    }
    const source = /^Mirror of https:\/\/github\.com\/([\w-]+)\/([\w.-]+)\.git(?:\n|$)/.exec(description);
    if (!source) throw new Error('Existing GitLab project has no verifiable mirror identity');
    const response = await this.fetch(`https://api.github.com/repos/${source[1]}/${source[2]}`, {
      headers: {Authorization: `Bearer ${this.githubToken}`, Accept: 'application/vnd.github+json'},
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error('Cannot verify the existing mirror through GitHub');
    const id = (await response.json()).id;
    if (id === repo.id) return true;
    if (Number.isSafeInteger(id) && allowDifferent) return false;
    throw new Error('Existing GitLab mirror identity does not match the source repository');
  }

  /** Secure non-public sources before transferring or allowing the Git push stage to proceed. */
  async secure(project, repo) {
    if (repo.targetVisibility !== 'private') return;
    const result = await this.request('PUT', `/projects/${project.id}`, {visibility: 'private'});
    if (result.status !== 200 || result.data.id !== project.id || result.data.visibility !== 'private') {
      throw new Error('GitLab privacy verification failed');
    }
  }

  /** Resolve an existing mirror or a new-project namespace, preserving legacy GitLab project IDs. */
  async prepare(repo) {
    const group = await this.group(repo.targetGroup, repo.name.split('/')[0]);
    if (repo.targetVisibility === 'public' && group.visibility !== 'public') {
      throw new Error('Public mirrors require a public GitLab group');
    }
    const desired = `${repo.targetGroup}/${repo.targetPath}`;
    const result = await this.request('GET', `/projects/${encodeURIComponent(desired)}`);
    let projectId = null;
    if (result.status === 200) {
      if (result.data.path_with_namespace !== desired || result.data.namespace?.id !== group.id) {
        throw new Error('GitLab project namespace verification failed');
      }
      await this.verifyIdentity(result.data, repo);
      if (result.data.archived) throw new Error('Existing GitLab mirror is archived and read-only');
      await this.secure(result.data, repo);
      projectId = result.data.id;
    } else if (![301, 404].includes(result.status)) {
      throw new Error(`Cannot read GitLab mirror (HTTP ${result.status})`);
    } else if (repo.targetGroup !== this.rootGroup) {
      projectId = await this.transferLegacy(repo, group);
    }
    return {...repo, namespaceId: group.id, projectId};
  }

  /** Find an original root mirror, verify it, then move that project rather than replacing its history. */
  async transferLegacy(repo, group) {
    const legacyPath = `${this.rootGroup}/${repo.targetPath}`;
    const legacy = await this.request('GET', `/projects/${encodeURIComponent(legacyPath)}`);
    if (legacy.status === 404) return null;
    if (legacy.status !== 200) throw new Error(`Cannot verify legacy GitLab mirror (HTTP ${legacy.status})`);
    const parent = await this.group(this.rootGroup);
    if (legacy.data.path_with_namespace !== legacyPath || legacy.data.namespace?.id !== parent.id) {
      throw new Error('Legacy GitLab mirror namespace verification failed');
    }
    if (!await this.verifyIdentity(legacy.data, repo, true)) return null;
    if (legacy.data.archived) throw new Error('Archived GitLab mirror requires a manual namespace transfer');
    await this.secure(legacy.data, repo);
    const result = await this.request('PUT', `/projects/${legacy.data.id}/transfer`, {namespace: group.id});
    if (![200, 201, 202].includes(result.status)) {
      throw new Error(`GitLab mirror transfer failed (HTTP ${result.status})`);
    }
    const desired = `${repo.targetGroup}/${repo.targetPath}`;
    await this.waitForTransfer(legacy.data.id, group.id, desired);
    return legacy.data.id;
  }

  /** GitLab transfers can be asynchronous; verify the same project reached the requested namespace. */
  async waitForTransfer(projectId, namespaceId, path, attemptsRemaining = 30) {
    const result = await this.request('GET', `/projects/${projectId}`);
    if (result.status !== 200 || result.data.id !== projectId) throw new Error('GitLab transfer verification failed');
    if (result.data.namespace?.id === namespaceId && result.data.path_with_namespace === path) return;
    if (attemptsRemaining <= 1) throw new Error('GitLab mirror transfer did not complete within one minute');
    await this.sleep(2000);
    return this.waitForTransfer(projectId, namespaceId, path, attemptsRemaining - 1);
  }
}

/** Prepare every repository independently so one permission or identity failure cannot stop other mirrors. */
export async function prepareMirrors(repositories, options) {
  const client = new GitLabMirrors(options);
  await client.group(client.rootGroup);
  const results = [];
  await forEachSequential(repositories, async repo => {
    try { results.push(await client.prepare(repo)); }
    catch (error) { results.push({...repo, preparationError: error.message}); }
  });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Mirror preparation does not accept CLI arguments');
  const path = new URL('../../repositories.json', import.meta.url);
  const prepared = await prepareMirrors(JSON.parse(readFileSync(path, 'utf8')), {
    gitlabToken: process.env.GITLAB_TOKEN, githubToken: process.env.GITHUB_TOKEN, rootGroup: process.env.GITLAB_GROUP,
  });
  writeFileSync(path, JSON.stringify(prepared), {mode: 0o600});
}
