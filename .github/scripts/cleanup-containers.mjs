const DOCKER_HUB_API = 'https://hub.docker.com/v2';
const DOCKER_REGISTRY = 'https://registry-1.docker.io';
const GHCR_REGISTRY = 'https://ghcr.io';
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
  while (pending.length > 0) {
    const digest = pending.pop();
    if (!digest || reachable.has(digest)) {
      continue;
    }
    reachable.add(digest);
    const manifest = await getManifest(digest);
    for (const child of manifest.manifests ?? []) {
      if (child.digest && !reachable.has(child.digest)) {
        pending.push(child.digest);
      }
    }
  }
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.json();
}

async function dockerHubToken(username, accessToken) {
  const response = await fetchJson(`${DOCKER_HUB_API}/auth/token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({identifier: username, secret: accessToken}),
  });
  const token = response.access_token ?? response.token;
  if (!token) {
    throw new Error('Docker Hub authentication did not return an access token.');
  }
  return token;
}

async function paginatedHubResults(url, token) {
  const results = [];
  let next = url;
  while (next) {
    const page = await fetchJson(next, {
      headers: {Authorization: `Bearer ${token}`},
    });
    results.push(...page.results);
    next = page.next;
  }
  return results;
}

async function dockerRegistryToken({namespace, repository, username, accessToken}) {
  const url = new URL('https://auth.docker.io/token');
  url.searchParams.set('service', 'registry.docker.io');
  url.searchParams.set('scope', `repository:${namespace}/${repository}:pull,push,delete`);
  const credentials = Buffer.from(`${username}:${accessToken}`).toString('base64');
  const response = await fetchJson(url, {
    headers: {Authorization: `Basic ${credentials}`},
  });
  if (!response.token) {
    throw new Error(`Docker Registry authentication failed for ${namespace}/${repository}.`);
  }
  return response.token;
}

async function deleteDockerHubTag({namespace, repository, tag, token}) {
  const response = await fetch(
    `${DOCKER_HUB_API}/namespaces/${encodeURIComponent(namespace)}`
      + `/repositories/${encodeURIComponent(repository)}/tags/${encodeURIComponent(tag)}`,
    {method: 'DELETE', headers: {Authorization: `Bearer ${token}`}},
  );
  if (!response.ok && response.status !== 404) {
    throw await responseError(response);
  }
}

async function deleteDockerManifest({namespace, repository, digest, token}) {
  const response = await fetch(
    `${DOCKER_REGISTRY}/v2/${namespace}/${repository}/manifests/${digest}`,
    {method: 'DELETE', headers: {Authorization: `Bearer ${token}`}},
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
  return new Map(repositories.map(({name}) => [name.toLowerCase(), name]));
}

/**
 * Clean every Docker Hub repository in a namespace which maps to a GitHub repo.
 *
 * @param {object} options Runtime dependencies and settings.
 * @returns {Promise<object>} Cleanup counts.
 */
export async function cleanupDockerHub({
  github,
  core,
  username,
  accessToken,
  dryRun,
  maxDeletions,
  organization = 'LizardByte',
  namespace = 'lizardbyte',
}) {
  if (!Number.isInteger(maxDeletions) || maxDeletions < 1) {
    throw new Error('maxDeletions must be a positive integer.');
  }
  const [hubToken, repositories] = await Promise.all([
    dockerHubToken(username, accessToken),
    loadRepositories(github, organization),
  ]);
  const githubRepositories = repositoryLookup(repositories);
  const hubRepositories = await paginatedHubResults(
    `${DOCKER_HUB_API}/namespaces/${namespace}/repositories?page_size=100`,
    hubToken,
  );
  let scanned = 0;
  let selectedTags = 0;
  let deletedActions = 0;
  let remaining = maxDeletions;
  let deferredActions = 0;

  for (const hubRepository of hubRepositories.sort((a, b) => a.name.localeCompare(b.name))) {
    const githubRepository = githubRepositories.get(hubRepository.name.toLowerCase());
    if (!githubRepository) {
      core.warning(`Skipping Docker Hub ${namespace}/${hubRepository.name}: no matching GitHub repository.`);
      continue;
    }

    const [tags, releaseTags] = await Promise.all([
      paginatedHubResults(
        `${DOCKER_HUB_API}/namespaces/${namespace}/repositories/`
          + `${encodeURIComponent(hubRepository.name)}/tags?page_size=100`,
        hubToken,
      ),
      loadReleaseTags(github, organization, githubRepository),
    ]);
    scanned += tags.length;
    const plan = planDockerHubCleanup(tags, releaseTags);
    selectedTags += plan.selectedTags;
    const selectedActions = plan.actions.slice(0, Math.max(remaining, 0));
    deferredActions += plan.actions.length - selectedActions.length;
    let registryToken;

    for (const action of selectedActions) {
      const description = action.kind === 'manifest'
        ? `${namespace}/${hubRepository.name}@${action.digest} (${action.tags.length} tags)`
        : `${namespace}/${hubRepository.name}:${action.tag}`;
      if (dryRun) {
        core.info(`[dry-run] Delete ${description}.`);
      } else if (action.kind === 'manifest') {
        registryToken ??= await dockerRegistryToken({
          namespace,
          repository: hubRepository.name,
          username,
          accessToken,
        });
        core.info(`Deleting ${description}.`);
        await deleteDockerManifest({
          namespace,
          repository: hubRepository.name,
          digest: action.digest,
          token: registryToken,
        });
      } else {
        core.info(`Deleting ${description}.`);
        await deleteDockerHubTag({
          namespace,
          repository: hubRepository.name,
          tag: action.tag,
          token: hubToken,
        });
      }
      deletedActions += 1;
      remaining -= 1;
    }
  }

  await core.summary
    .addHeading(`Docker Hub ${namespace} cleanup`, 2)
    .addTable([
      [{data: 'Mode', header: true}, {data: dryRun ? 'Dry run' : 'Delete'}],
      [{data: 'Repositories scanned', header: true}, {data: String(hubRepositories.length)}],
      [{data: 'Tags scanned', header: true}, {data: String(scanned)}],
      [{data: 'Tags selected', header: true}, {data: String(selectedTags)}],
      [{data: 'Delete operations selected', header: true}, {data: String(deletedActions)}],
      [{data: 'Operations deferred', header: true}, {data: String(deferredActions)}],
    ])
    .write();

  return {repositories: hubRepositories.length, scanned, selectedTags, deletedActions, deferredActions};
}

async function ghcrToken({namespace, packageName, username, accessToken}) {
  const url = new URL(`${GHCR_REGISTRY}/token`);
  url.searchParams.set('service', 'ghcr.io');
  url.searchParams.set('scope', `repository:${namespace}/${packageName}:pull`);
  const credentials = Buffer.from(`${username}:${accessToken}`).toString('base64');
  const response = await fetchJson(url, {
    headers: {Authorization: `Basic ${credentials}`},
  });
  const token = response.token ?? response.access_token;
  if (!token) {
    throw new Error(`GHCR authentication failed for ${namespace}/${packageName}.`);
  }
  return token;
}

async function getGhcrManifest({namespace, packageName, digest, token}) {
  const packagePath = packageName.split('/').map(encodeURIComponent).join('/');
  return fetchJson(`${GHCR_REGISTRY}/v2/${namespace}/${packagePath}/manifests/${digest}`, {
    headers: {
      Accept: MANIFEST_ACCEPT,
      Authorization: `Bearer ${token}`,
    },
  });
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
}) {
  if (!Number.isInteger(maxDeletions) || maxDeletions < 1) {
    throw new Error('maxDeletions must be a positive integer.');
  }
  const [packages, repositories] = await Promise.all([
    github.paginate('GET /orgs/{org}/packages', {
      org: organization,
      package_type: 'container',
      per_page: 100,
    }),
    loadRepositories(github, organization),
  ]);
  const githubRepositories = repositoryLookup(repositories);
  let scanned = 0;
  let selected = 0;
  let operations = 0;
  let deferred = 0;
  let remaining = maxDeletions;

  for (const packageData of packages.sort((a, b) => a.name.localeCompare(b.name))) {
    const githubRepository = githubRepositories.get(packageData.name.toLowerCase());
    if (!githubRepository) {
      core.warning(`Skipping GHCR ${namespace}/${packageData.name}: no matching GitHub repository.`);
      continue;
    }

    const [versions, releaseTags] = await Promise.all([
      github.paginate(
        'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
        {
          org: organization,
          package_type: 'container',
          package_name: packageData.name,
          per_page: 100,
        },
      ),
      loadReleaseTags(github, organization, githubRepository),
    ]);
    scanned += versions.length;
    const classification = classifyGhcrVersions(versions, releaseTags);
    let reachable;
    try {
      const registryToken = await ghcrToken({
        namespace,
        packageName: packageData.name,
        username,
        accessToken,
      });
      reachable = await resolveReachableDigests(
        classification.roots.map(({name}) => name),
        (digest) => getGhcrManifest({
          namespace,
          packageName: packageData.name,
          digest,
          token: registryToken,
        }),
      );
    } catch (error) {
      core.warning(
        `Skipping GHCR ${namespace}/${packageData.name}: retained manifest graph could not be read: `
          + error.message,
      );
      continue;
    }

    const candidates = ghcrCleanupCandidates(classification, reachable);
    selected += candidates.length;
    const selectedVersions = candidates.slice(0, Math.max(remaining, 0));
    deferred += candidates.length - selectedVersions.length;

    for (const version of selectedVersions) {
      const tags = versionTags(version);
      const description = tags.length > 0
        ? `${namespace}/${packageData.name}:${tags.join(',')}`
        : `${namespace}/${packageData.name}@${version.name}`;
      if (dryRun) {
        core.info(`[dry-run] Delete ${description} (version ${version.id}).`);
      } else {
        core.info(`Deleting ${description} (version ${version.id}).`);
        await deleteGhcrVersion({
          github,
          organization,
          packageName: packageData.name,
          versionId: version.id,
        });
      }
      operations += 1;
      remaining -= 1;
    }
  }

  await core.summary
    .addHeading(`GHCR ${namespace} cleanup`, 2)
    .addTable([
      [{data: 'Mode', header: true}, {data: dryRun ? 'Dry run' : 'Delete'}],
      [{data: 'Packages scanned', header: true}, {data: String(packages.length)}],
      [{data: 'Versions scanned', header: true}, {data: String(scanned)}],
      [{data: 'Versions selected', header: true}, {data: String(selected)}],
      [{data: 'Delete operations selected', header: true}, {data: String(operations)}],
      [{data: 'Versions deferred', header: true}, {data: String(deferred)}],
    ])
    .write();

  return {packages: packages.length, scanned, selected, operations, deferred};
}
