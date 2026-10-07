import {collectPages, forEachSequential} from './async-iteration.mjs';
import {CleanupStopped, createCleanupRuntime} from './cleanup-runtime.mjs';

const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const DOCKER_REGISTRY = 'https://registry-1.docker.io';
const GHCR_REGISTRY = 'https://ghcr.io';
const GITHUB_API_RESERVE = 500;
const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.artifact.manifest.v1+json',
].join(', ');
const MOVING_TAGS = ['latest', 'master', 'test'];

function isRecent(timestamp, now, graceMs) {
  const time = Date.parse(timestamp ?? '');
  return Number.isFinite(time) && now - time < graceMs;
}

/**
 * Return published stable and prerelease tags, excluding drafts.
 *
 * @param {Array<object>} releases GitHub releases.
 * @returns {Set<string>} Published release tags.
 */
export function publishedReleaseTags(releases) {
  return new Set(
    releases
      .filter((release) => !release.draft && release.tag_name)
      .map((release) => release.tag_name),
  );
}

/**
 * Check whether a container tag is a retained release or moving alias.
 *
 * Image variants append a hyphenated suffix to the base tag.
 *
 * @param {string} tag Container tag.
 * @param {Iterable<string>} releaseTags Published GitHub release tags.
 * @returns {boolean} Whether the tag must be retained.
 */
export function isRetainedContainerTag(tag, releaseTags) {
  const candidate = String(tag ?? '');
  for (const alias of MOVING_TAGS) {
    if (candidate === alias || candidate.startsWith(`${alias}-`)) {
      return true;
    }
  }
  for (const releaseTag of releaseTags) {
    if (candidate === releaseTag || candidate.startsWith(`${releaseTag}-`)) {
      return true;
    }
  }
  return false;
}

/**
 * Plan Docker Hub cleanup, collapsing fully stale tag groups to one digest delete.
 *
 * @param {Array<object>} tags Docker Hub tags.
 * @param {Set<string>} releaseTags Published release tags.
 * @param {object} [options] Planning options.
 * @returns {{actions: Array<object>, retained: number, selectedTags: number}} Cleanup plan.
 */
export function planDockerHubCleanup(tags, releaseTags, {
  now = Date.now(),
  graceMs = DEFAULT_GRACE_MS,
} = {}) {
  const groups = new Map();
  for (const tag of tags) {
    const digest = tag.digest || `tag:${tag.name}`;
    const item = {
      ...tag,
      retained: isRetainedContainerTag(tag.name, releaseTags)
        || isRecent(tag.last_updated, now, graceMs),
    };
    const group = groups.get(digest) ?? [];
    group.push(item);
    groups.set(digest, group);
  }

  const actions = [];
  let retained = 0;
  let selectedTags = 0;
  for (const [digest, group] of groups) {
    retained += group.filter(({retained: keep}) => keep).length;
    const stale = group.filter(({retained: keep}) => !keep);
    selectedTags += stale.length;
    if (stale.length === 0) {
      continue;
    }

    if (!digest.startsWith('tag:') && stale.length === group.length) {
      actions.push({
        kind: 'manifest',
        digest,
        tags: stale.map(({name}) => name),
        updatedAt: stale.map(({last_updated}) => last_updated).sort()[0],
      });
    } else {
      for (const tag of stale) {
        actions.push({
          kind: 'tag',
          tag: tag.name,
          tags: [tag.name],
          updatedAt: tag.last_updated,
        });
      }
    }
  }

  actions.sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
  return {actions, retained, selectedTags};
}

function versionTags(version) {
  return version.metadata?.container?.tags ?? [];
}

/**
 * Classify GHCR package versions before resolving retained manifest graphs.
 *
 * @param {Array<object>} versions GHCR package versions.
 * @param {Set<string>} releaseTags Published GitHub release tags.
 * @param {object} [options] Planning options.
 * @returns {{roots: Array<object>, staleTagged: Array<object>, staleUntagged: Array<object>}} Classification.
 */
export function classifyGhcrVersions(versions, releaseTags, {
  now = Date.now(),
  graceMs = DEFAULT_GRACE_MS,
} = {}) {
  const result = {roots: [], staleTagged: [], staleUntagged: []};
  for (const version of versions) {
    const tags = versionTags(version);
    const keep = tags.some((tag) => isRetainedContainerTag(tag, releaseTags))
      || isRecent(version.updated_at ?? version.created_at, now, graceMs);
    if (keep) {
      result.roots.push(version);
    } else if (tags.length > 0) {
      result.staleTagged.push(version);
    } else {
      result.staleUntagged.push(version);
    }
  }
  return result;
}

function* pendingDigests(pending, reachable) {
  while (pending.length > 0) {
    const digest = pending.pop();
    if (!digest || reachable.has(digest)) {
      continue;
    }
    reachable.add(digest);
    yield digest;
  }
}

/**
 * Resolve every child manifest reachable from retained GHCR versions.
 *
 * @param {Iterable<string>} rootDigests Retained manifest digests.
 * @param {(digest: string) => Promise<object>} getManifest Manifest loader.
 * @returns {Promise<Set<string>>} Reachable manifest digests.
 */
export async function resolveReachableDigests(rootDigests, getManifest) {
  const reachable = new Set();
  const pending = [...rootDigests];
  await forEachSequential(pendingDigests(pending, reachable), async (digest) => {
    const manifest = await getManifest(digest);
    for (const child of manifest.manifests ?? []) {
      if (child.digest && !reachable.has(child.digest)) {
        pending.push(child.digest);
      }
    }
  });
  return reachable;
}

/**
 * Select stale GHCR versions after the retained manifest graph is known.
 * Tagged parent versions are deliberately returned before orphaned children.
 *
 * @param {object} classification Result from classifyGhcrVersions.
 * @param {Set<string>} reachable Digests reachable from retained versions.
 * @returns {Array<object>} Versions safe to delete.
 */
export function ghcrCleanupCandidates(classification, reachable) {
  return [
    ...classification.staleTagged,
    ...classification.staleUntagged.filter(({name}) => !reachable.has(name)),
  ];
}

async function responseError(response) {
  const body = await response.text();
  return new Error(`${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
}

async function fetchJson(url, options = {}, request = fetch) {
  const response = await request(url, options);
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.json();
}

async function dockerHubToken(username, accessToken, request) {
  const response = await fetchJson(`${DOCKER_HUB_API}/auth/token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({identifier: username, secret: accessToken}),
  }, request);
  const token = response.access_token ?? response.token;
  if (!token) {
    throw new Error('Docker Hub authentication did not return an access token.');
  }
  return token;
}

/**
 * Cache a Docker bearer token and refresh it once when a request is unauthorized.
 * The refreshed token is reused by subsequent requests during long cleanups.
 *
 * @param {() => Promise<string>} loadToken Docker Hub or scoped registry token loader.
 * @returns {Promise<Function>} Authenticated request function.
 */
async function refreshingDockerRequest(loadToken, fetcher) {
  let token = await loadToken();
  return async (url, options = {}) => {
    const request = () => fetcher(url, {
      ...options,
      headers: {...options.headers, Authorization: `Bearer ${token}`},
    });
    let response = await request();
    if (response.status === 401) {
      await response.body?.cancel();
      token = await loadToken();
      response = await request();
    }
    return response;
  };
}

async function paginatedHubResults(url, request) {
  return collectPages(url, async (cursor) => {
    const page = await fetchJson(cursor, {}, request);
    return {items: page.results, nextCursor: page.next || null};
  });
}

async function dockerRegistryToken({namespace, repository, username, accessToken}, request) {
  const url = new URL('https://auth.docker.io/token');
  url.searchParams.set('service', 'registry.docker.io');
  url.searchParams.set('scope', `repository:${namespace}/${repository}:pull,push,delete`);
  const credentials = Buffer.from(`${username}:${accessToken}`).toString('base64');
  const response = await fetchJson(url, {
    headers: {Authorization: `Basic ${credentials}`},
  }, request);
  if (!response.token) {
    throw new Error(`Docker Registry authentication failed for ${namespace}/${repository}.`);
  }
  return response.token;
}

async function deleteDockerHubTag({namespace, repository, tag, request}) {
  const response = await request(
    `${DOCKER_HUB_API}/namespaces/${encodeURIComponent(namespace)}`
      + `/repositories/${encodeURIComponent(repository)}/tags/${encodeURIComponent(tag)}`,
    {method: 'DELETE'},
  );
  if (!response.ok && response.status !== 404) {
    throw await responseError(response);
  }
}

async function deleteDockerManifest({namespace, repository, digest, request}) {
  const response = await request(
    `${DOCKER_REGISTRY}/v2/${namespace}/${repository}/manifests/${digest}`,
    {method: 'DELETE'},
  );
  if (!response.ok && response.status !== 404) {
    throw await responseError(response);
  }
}

async function loadRepositories(github, organization) {
  return github.paginate(github.rest.repos.listForOrg, {
    org: organization,
    per_page: 100,
    type: 'all',
  });
}

async function loadReleaseTags(github, organization, repository) {
  const releases = await github.paginate(github.rest.repos.listReleases, {
    owner: organization,
    repo: repository,
    per_page: 100,
  });
  return publishedReleaseTags(releases);
}

function repositoryLookup(repositories) {
  const lookup = new Map(repositories.map(({name}) => [name.toLowerCase(), name]));
  // Legacy containers retain releases from the renamed GitHub repository in both registries.
  if (lookup.has('themerr') && !lookup.has('themerr-plex')) {
    lookup.set('themerr-plex', lookup.get('themerr'));
  }
  return lookup;
}

/**
 * Resolve the shared deletion budget, allowing omitted limits and GitHub's numeric default of zero.
 *
 * @param {number} [maxDeletions] Maximum delete operations; omitted or zero means unlimited.
 * @returns {number} Positive deletion budget or Infinity.
 */
function deletionBudget(maxDeletions) {
  if (maxDeletions === undefined || maxDeletions === 0) {
    return Infinity;
  }
  if (!Number.isInteger(maxDeletions) || maxDeletions < 1) {
    throw new Error('maxDeletions must be a positive integer, zero, or omitted.');
  }
  return maxDeletions;
}

async function cleanupHubRepository({
  github, core, namespace, organization, username, accessToken, dryRun, runtime,
  hubRequest, hubRepository, githubRepositories, counts, progress, budget,
}) {
  runtime.check();
  const githubRepository = githubRepositories.get(hubRepository.name.toLowerCase());
  if (!githubRepository) {
    core.warning(`Skipping Docker Hub ${namespace}/${hubRepository.name}: no matching GitHub repository.`);
    return;
  }
  const [tags, releaseTags] = await Promise.all([
    paginatedHubResults(
      `${DOCKER_HUB_API}/namespaces/${namespace}/repositories/`
        + `${encodeURIComponent(hubRepository.name)}/tags?page_size=100`, hubRequest,
    ),
    loadReleaseTags(github, organization, githubRepository),
  ]);
  runtime.check();
  counts.scanned += tags.length;
  const plan = planDockerHubCleanup(tags, releaseTags);
  counts.selectedTags += plan.selectedTags;
  counts.deferredActions += plan.actions.length;
  const selectedActions = plan.actions.slice(0, Math.max(budget.remaining, 0));
  let registryRequest;
  await forEachSequential(selectedActions, async (action) => {
    runtime.check();
    const description = action.kind === 'manifest'
      ? `${namespace}/${hubRepository.name}@${action.digest} (${action.tags.length} tags)`
      : `${namespace}/${hubRepository.name}:${action.tag}`;
    if (dryRun) {
      core.info(`[dry-run] Delete ${description}.`);
    } else if (action.kind === 'manifest') {
      registryRequest ??= await refreshingDockerRequest(() => dockerRegistryToken({
        namespace, repository: hubRepository.name, username, accessToken,
      }, runtime.fetch), runtime.fetch);
      core.info(`Deleting ${description}.`);
      await deleteDockerManifest({
        namespace, repository: hubRepository.name, digest: action.digest, request: registryRequest,
      });
    } else {
      core.info(`Deleting ${description}.`);
      await deleteDockerHubTag({namespace, repository: hubRepository.name, tag: action.tag, request: hubRequest});
    }
    counts.deletedActions += 1;
    counts.deferredActions -= 1;
    progress.deleted += dryRun ? 0 : 1;
    progress.tagsDeleted += dryRun ? 0 : action.tags.length;
    budget.remaining -= 1;
  });
}

async function writeHubSummary({core, namespace, dryRun, counts, progress, status, inventoryComplete}) {
  await core.summary
    .addHeading(`Docker Hub ${namespace} cleanup`, 2)
    .addTable([
      [{data: 'Mode', header: true}, {data: dryRun ? 'Dry run' : 'Delete'}],
      [{data: 'Status', header: true}, {data: status}],
      [{data: 'Inventory scan', header: true}, {data: inventoryComplete ? 'Complete' : 'Partial'}],
      [{data: 'Repositories listed', header: true}, {data: String(counts.repositories)}],
      [{data: 'Tags scanned', header: true}, {data: String(counts.scanned)}],
      [{data: 'Tags selected', header: true}, {data: String(counts.selectedTags)}],
      [{data: 'Delete operations processed', header: true}, {data: String(counts.deletedActions)}],
      [{data: 'Delete operations completed', header: true}, {data: String(progress.deleted)}],
      [{data: 'Tags cleaned', header: true}, {data: String(progress.tagsDeleted)}],
      [{data: 'Known operations deferred', header: true}, {data: String(counts.deferredActions)}],
    ])
    .write();
}

/**
 * Clean every Docker Hub repository in a namespace which maps to a GitHub repo.
 *
 * @param {object} options Runtime dependencies and settings.
 * @returns {Promise<object>} Cleanup counts.
 */
export async function cleanupDockerHub({
  github, core, username, accessToken, dryRun, maxDeletions,
  organization = 'LizardByte', namespace = 'lizardbyte', runtime,
}) {
  const budget = {remaining: deletionBudget(maxDeletions)};
  runtime ??= createCleanupRuntime();
  const counts = {repositories: 0, scanned: 0, selectedTags: 0, deletedActions: 0, deferredActions: 0};
  const progress = {deleted: 0, tagsDeleted: 0};
  let inventoryComplete = false;
  let status = 'Completed';
  try {
    await runtime.run(async () => {
      const api = runtime.github(github);
      const [hubRequest, repositories] = await Promise.all([
        refreshingDockerRequest(() => dockerHubToken(username, accessToken, runtime.fetch), runtime.fetch),
        loadRepositories(api, organization),
      ]);
      const githubRepositories = repositoryLookup(repositories);
      const hubRepositories = await paginatedHubResults(
        `${DOCKER_HUB_API}/namespaces/${namespace}/repositories?page_size=100`, hubRequest,
      );
      counts.repositories = hubRepositories.length;
      // Keep repository budgets and registry mutations in deterministic order.
      await forEachSequential(hubRepositories.toSorted((a, b) => a.name.localeCompare(b.name)), (hubRepository) => (
        cleanupHubRepository({
          github: api, core, namespace, organization, username, accessToken, dryRun, runtime,
          hubRequest, hubRepository, githubRepositories, counts, progress, budget,
        })
      ));
      inventoryComplete = true;
    });
  } catch (error) {
    if (error instanceof CleanupStopped) {
      status = error.message;
      core.warning(`Stopping Docker Hub cleanup: ${status}`);
    } else {
      status = `Failed: ${error.message}`;
      throw error;
    }
  } finally {
    runtime.dispose();
    await writeHubSummary({core, namespace, dryRun, counts, progress, status, inventoryComplete});
  }
  return counts;
}

async function ghcrToken({namespace, packageName, username, accessToken}, request) {
  const url = new URL(`${GHCR_REGISTRY}/token`);
  url.searchParams.set('service', 'ghcr.io');
  url.searchParams.set('scope', `repository:${namespace}/${packageName}:pull`);
  const credentials = Buffer.from(`${username}:${accessToken}`).toString('base64');
  const response = await fetchJson(url, {
    headers: {Authorization: `Basic ${credentials}`},
  }, request);
  const token = response.token ?? response.access_token;
  if (!token) {
    throw new Error(`GHCR authentication failed for ${namespace}/${packageName}.`);
  }
  return token;
}

async function getGhcrManifest({namespace, packageName, digest, token}, request) {
  const packagePath = packageName.split('/').map(encodeURIComponent).join('/');
  return fetchJson(`${GHCR_REGISTRY}/v2/${namespace}/${packagePath}/manifests/${digest}`, {
    headers: {
      Accept: MANIFEST_ACCEPT,
      Authorization: `Bearer ${token}`,
    },
  }, request);
}

class GitHubCleanupStopped extends CleanupStopped {}

function githubCallsRemaining(headers) {
  const value = headers?.['x-ratelimit-remaining'];
  const remaining = Number(value);
  return value !== undefined && value !== null && String(value).trim() !== ''
    && Number.isInteger(remaining) && remaining >= 0
    ? remaining : undefined;
}

function isGitHubRateLimitError(error) {
  const status = error.status ?? error.response?.status;
  const headers = error.response?.headers;
  const message = `${error.message ?? ''} ${error.response?.data?.message ?? ''}`;
  return (status === 403 || status === 429) && (
    status === 429
    || githubCallsRemaining(headers) === 0
    || headers?.['retry-after'] !== undefined
    || /rate limit|abuse detection/i.test(message)
  );
}

/**
 * Reserve GitHub API calls, including every page of inventory and release reads.
 * Stop pagination rather than returning an incomplete inventory for deletion planning.
 *
 * @param {object} github GitHub Actions Octokit client.
 * @returns {Promise<object>} Guarded client with the last known remaining call count.
 */
async function cleanupGitHubApi(github) {
  // This endpoint does not consume the primary rate limit.
  const response = await github.request('GET /rate_limit');
  let remaining = githubCallsRemaining(response.headers) ?? response.data?.resources?.core?.remaining;
  if (!Number.isInteger(remaining) || remaining < 0) {
    throw new GitHubCleanupStopped('Cannot determine the remaining GitHub API budget.');
  }

  const checkReserve = () => {
    if (remaining <= GITHUB_API_RESERVE) {
      throw new GitHubCleanupStopped(
        `GitHub API budget is at or below the ${GITHUB_API_RESERVE}-call reserve (${remaining} remaining).`,
      );
    }
  };
  const observe = (headers) => {
    remaining = githubCallsRemaining(headers) ?? Math.max(remaining - 1, 0);
  };
  const run = async (operation) => {
    checkReserve();
    try {
      return await operation();
    } catch (error) {
      if (isGitHubRateLimitError(error)) {
        observe(error.response?.headers);
        throw new GitHubCleanupStopped(
          'GitHub API rate limit reached; remaining cleanup is deferred.', {cause: error},
        );
      }
      throw error;
    }
  };

  return {
    rest: github.rest,
    get remaining() { return remaining; },
    paginate: (route, options) => run(() => github.paginate(route, options, (page) => {
      observe(page.headers);
      // Check between pages so a long inventory scan cannot consume the reserve.
      if (page.headers?.link?.includes('rel="next"')) {
        checkReserve();
      }
      return page.data;
    })),
    request: (route, options) => run(async () => {
      const result = await github.request(route, options);
      observe(result.headers);
      return result;
    }),
  };
}

async function deleteGhcrVersion({github, organization, packageName, versionId}) {
  await github.request(
    'DELETE /orgs/{org}/packages/{package_type}/{package_name}/versions/{package_version_id}',
    {
      org: organization,
      package_type: 'container',
      package_name: packageName,
      package_version_id: versionId,
    },
  );
}

async function deleteSelectedGhcrVersions({
  github,
  core,
  organization,
  namespace,
  packageName,
  selectedVersions,
  dryRun,
  onProcessed,
  runtime,
}) {
  // Tagged parent versions must be deleted before their orphaned children.
  await forEachSequential(selectedVersions, async (version) => {
    runtime.check();
    const tags = versionTags(version);
    const description = tags.length > 0
      ? `${namespace}/${packageName}:${tags.join(',')}`
      : `${namespace}/${packageName}@${version.name}`;
    if (dryRun) {
      core.info(`[dry-run] Delete ${description} (version ${version.id}).`);
    } else {
      core.info(`Deleting ${description} (version ${version.id}).`);
      await deleteGhcrVersion({
        github,
        organization,
        packageName,
        versionId: version.id,
      });
    }
    // Record only confirmed deletions (or dry-run selections), even if the next request stops cleanup.
    onProcessed();
  });
}

async function cleanupGhcrPackage({
  github, core, organization, namespace, packageData, githubRepositories, username, accessToken,
  dryRun, counts, budget, runtime,
}) {
  runtime.check();
  const githubRepository = githubRepositories.get(packageData.name.toLowerCase());
  if (!githubRepository) {
    core.warning(`Skipping GHCR ${namespace}/${packageData.name}: no matching GitHub repository.`);
    return;
  }

  // Serialize GitHub calls so each request checks the budget from the preceding response.
  const versions = await github.paginate(
    'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
    {org: organization, package_type: 'container', package_name: packageData.name, per_page: 100},
  );
  const releaseTags = await loadReleaseTags(github, organization, githubRepository);
  counts.scanned += versions.length;
  const classification = classifyGhcrVersions(versions, releaseTags);
  let reachable;
  try {
    const registryToken = await ghcrToken({
      namespace, packageName: packageData.name, username, accessToken,
    }, runtime.fetch);
    reachable = await resolveReachableDigests(
      classification.roots.map(({name}) => name),
      (digest) => getGhcrManifest({
        namespace, packageName: packageData.name, digest, token: registryToken,
      }, runtime.fetch),
    );
  } catch (error) {
    runtime.check();
    if (error instanceof CleanupStopped) {
      throw error;
    }
    core.warning(
      `Skipping GHCR ${namespace}/${packageData.name}: retained manifest graph could not be read: ` + error.message,
    );
    return;
  }

  const candidates = ghcrCleanupCandidates(classification, reachable);
  counts.selected += candidates.length;
  counts.deferred += candidates.length;
  const selectedVersions = candidates.slice(0, Math.max(budget.remaining, 0));
  await deleteSelectedGhcrVersions({
    github, core, organization, namespace, packageName: packageData.name, selectedVersions, dryRun, runtime,
    onProcessed() {
      counts.operations += 1;
      counts.deleted += dryRun ? 0 : 1;
      counts.deferred -= 1;
      budget.remaining -= 1;
    },
  });
}

async function writeGhcrSummary({core, namespace, dryRun, counts, status, inventoryComplete, apiRemaining}) {
  await core.summary
    .addHeading(`GHCR ${namespace} cleanup`, 2)
    .addTable([
      [{data: 'Mode', header: true}, {data: dryRun ? 'Dry run' : 'Delete'}],
      [{data: 'Status', header: true}, {data: status}],
      [{data: 'Inventory scan', header: true}, {data: inventoryComplete ? 'Complete' : 'Partial'}],
      [{data: 'Packages listed', header: true}, {data: String(counts.packages)}],
      [{data: 'Versions scanned', header: true}, {data: String(counts.scanned)}],
      [{data: 'Versions selected', header: true}, {data: String(counts.selected)}],
      [{data: 'Delete operations processed', header: true}, {data: String(counts.operations)}],
      [{data: 'Versions deleted', header: true}, {data: String(counts.deleted)}],
      [{data: 'Known versions deferred', header: true}, {data: String(counts.deferred)}],
      [{data: 'GitHub API calls remaining', header: true}, {data: String(apiRemaining ?? 'Unknown')}],
      [{data: 'GitHub API reserve target', header: true}, {data: String(GITHUB_API_RESERVE)}],
    ])
    .write();
}

/**
 * Clean GHCR package versions while preserving retained multi-arch graphs.
 *
 * @param {object} options Runtime dependencies and settings.
 * @returns {Promise<object>} Cleanup counts.
 */
export async function cleanupGhcr({
  github,
  core,
  username,
  accessToken,
  dryRun,
  maxDeletions,
  organization = 'LizardByte',
  namespace = 'lizardbyte',
  runtime,
}) {
  const budget = {remaining: deletionBudget(maxDeletions)};
  runtime ??= createCleanupRuntime();
  const counts = {packages: 0, scanned: 0, selected: 0, operations: 0, deleted: 0, deferred: 0};
  let api;
  let apiRemaining;
  let inventoryComplete = false;
  let status = 'Completed';
  try {
    await runtime.run(async () => {
      api = await cleanupGitHubApi(runtime.github(github));
      const packages = await api.paginate('GET /orgs/{org}/packages', {
        org: organization, package_type: 'container', per_page: 100,
      });
      counts.packages = packages.length;
      const githubRepositories = repositoryLookup(await loadRepositories(api, organization));
      // Finish each package before consuming the shared deletion and API budgets for the next.
      await forEachSequential(packages.toSorted((a, b) => a.name.localeCompare(b.name)), (packageData) => (
        cleanupGhcrPackage({
          github: api, core, organization, namespace, packageData, githubRepositories, username, accessToken,
          dryRun, counts, budget, runtime,
        })
      ));
      inventoryComplete = true;
    });
  } catch (error) {
    if (error instanceof CleanupStopped || isGitHubRateLimitError(error)) {
      status = error instanceof CleanupStopped ? error.message : 'GitHub API rate limit reached.';
      apiRemaining = githubCallsRemaining(error.response?.headers);
      core.warning(`Stopping GHCR cleanup: ${status}`);
    } else {
      status = `Failed: ${error.message}`;
      throw error;
    }
  } finally {
    runtime.dispose();
    await writeGhcrSummary({
      core, namespace, dryRun, counts, status, inventoryComplete, apiRemaining: apiRemaining ?? api?.remaining,
    });
  }
  return counts;
}
