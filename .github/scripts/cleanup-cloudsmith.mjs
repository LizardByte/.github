const CLOUDSMITH_API = 'https://api.cloudsmith.io/v1';
const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Return the package version used by native packages for a GitHub release tag.
 *
 * @param {string} tag Release tag.
 * @returns {string} Native package version prefix.
 */
export function releaseVersion(tag) {
  return String(tag ?? '').trim().replace(/^v(?=\d)/i, '');
}

/**
 * Determine whether a native package version belongs to a GitHub release.
 *
 * DEB and RPM package versions append their packaging release after a hyphen.
 * Exact matches cover formats which do not add a packaging release.
 *
 * @param {string} packageVersion Cloudsmith package version.
 * @param {Iterable<string>} releaseTags Published GitHub release tags.
 * @returns {boolean} Whether the package belongs to a published release.
 */
export function packageMatchesRelease(packageVersion, releaseTags) {
  const candidate = String(packageVersion ?? '').trim();
  if (!candidate) {
    return false;
  }

  for (const tag of releaseTags) {
    const version = releaseVersion(tag);
    if (version && (candidate === version || candidate.startsWith(`${version}-`))) {
      return true;
    }
  }
  return false;
}

/**
 * Check all Cloudsmith tag groups for a tag.
 *
 * @param {object} packageData Cloudsmith package.
 * @param {string} tag Package tag.
 * @returns {boolean} Whether the tag exists.
 */
export function hasCloudsmithTag(packageData, tag) {
  return Object.values(packageData.tags ?? {}).some(
    (values) => Array.isArray(values) && values.includes(tag),
  );
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

function isRecent(timestamp, now, graceMs) {
  const time = Date.parse(timestamp ?? '');
  return Number.isFinite(time) && now - time < graceMs;
}

/**
 * Build a fail-closed Cloudsmith cleanup plan.
 *
 * Package names map case-insensitively to GitHub repository names. Unknown
 * package names and packages which Cloudsmith cannot currently delete are kept.
 *
 * @param {object} options Planning options.
 * @param {Array<object>} options.packages Cloudsmith packages.
 * @param {Array<object>} options.repositories GitHub repositories.
 * @param {Map<string, Set<string>>} options.releaseTagsByRepository Tags keyed by lower-case repo name.
 * @param {number} [options.now] Current time in milliseconds.
 * @param {number} [options.graceMs] New-package grace period.
 * @returns {{keep: Array<object>, remove: Array<object>}} Cleanup plan.
 */
export function planCloudsmithCleanup({
  packages,
  repositories,
  releaseTagsByRepository,
  now = Date.now(),
  graceMs = DEFAULT_GRACE_MS,
}) {
  const repositoryNames = new Map(
    repositories.map((repository) => [repository.name.toLowerCase(), repository.name]),
  );
  const plan = {keep: [], remove: []};

  for (const packageData of packages) {
    const packageName = String(packageData.name ?? '');
    const repositoryName = repositoryNames.get(packageName.toLowerCase());
    let reason;

    if (!repositoryName) {
      reason = 'unknown GitHub repository';
    } else if (!packageData.identifier_perm && !packageData.slug_perm) {
      reason = 'missing Cloudsmith identifier';
    } else if (packageData.is_deleteable === false) {
      reason = 'not deleteable';
    } else if (hasCloudsmithTag(packageData, 'latest')) {
      reason = 'latest package for target';
    } else if (isRecent(packageData.uploaded_at, now, graceMs)) {
      reason = 'within publish grace period';
    } else {
      const tags = releaseTagsByRepository.get(repositoryName.toLowerCase()) ?? new Set();
      if (packageMatchesRelease(packageData.version_orig ?? packageData.version, tags)) {
        reason = 'published GitHub release';
      }
    }

    const item = {package: packageData, repository: repositoryName, reason};
    if (reason) {
      plan.keep.push(item);
    } else {
      plan.remove.push(item);
    }
  }

  return plan;
}

async function responseError(response) {
  const body = await response.text();
  return new Error(`${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
}

async function listCloudsmithPackages({owner, repository, token}) {
  const packages = [];
  const pageSize = 100;

  for (let page = 1; ; page += 1) {
    const url = new URL(`${CLOUDSMITH_API}/packages/${owner}/${repository}/`);
    url.searchParams.set('page', page);
    url.searchParams.set('page_size', pageSize);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'LizardByte-artifact-cleanup',
      },
    });
    if (!response.ok) {
      throw await responseError(response);
    }

    const pagePackages = await response.json();
    packages.push(...pagePackages);
    const lastPage = Number(response.headers.get('x-pagination-pagetotal'));
    if ((Number.isFinite(lastPage) && page >= lastPage) || pagePackages.length < pageSize) {
      break;
    }
  }

  return packages;
}

async function deleteCloudsmithPackage({owner, repository, token, identifier}) {
  const response = await fetch(
    `${CLOUDSMITH_API}/packages/${owner}/${repository}/${encodeURIComponent(identifier)}/`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'LizardByte-artifact-cleanup',
      },
    },
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

async function loadReleaseTags(github, organization, repositoryNames) {
  const tagsByRepository = new Map();
  for (const repository of repositoryNames) {
    const releases = await github.paginate(github.rest.repos.listReleases, {
      owner: organization,
      repo: repository,
      per_page: 100,
    });
    tagsByRepository.set(repository.toLowerCase(), publishedReleaseTags(releases));
  }
  return tagsByRepository;
}

function packageLabel(packageData) {
  const architecture = (packageData.architectures ?? []).map(({name}) => name).join(',');
  const target = [
    packageData.format,
    packageData.distro?.slug,
    packageData.distro_version?.slug,
    architecture,
  ].filter(Boolean).join('/');
  return `${packageData.name} ${packageData.version} (${target})`;
}

/**
 * Clean a Cloudsmith repository against the organization's published releases.
 *
 * @param {object} options Runtime dependencies and settings.
 * @returns {Promise<object>} Cleanup counts.
 */
export async function cleanupCloudsmith({
  github,
  core,
  token,
  dryRun,
  organization = 'LizardByte',
  owner = 'lizardbyte',
  repository = 'beta',
}) {
  const [packages, repositories] = await Promise.all([
    listCloudsmithPackages({owner, repository, token}),
    loadRepositories(github, organization),
  ]);
  const knownNames = new Set(repositories.map(({name}) => name.toLowerCase()));
  const matchedRepositories = new Set(
    packages
      .map(({name}) => repositories.find(
        (repositoryData) => repositoryData.name.toLowerCase() === String(name).toLowerCase(),
      )?.name)
      .filter(Boolean),
  );
  const releaseTagsByRepository = await loadReleaseTags(
    github,
    organization,
    [...matchedRepositories],
  );
  const plan = planCloudsmithCleanup({packages, repositories, releaseTagsByRepository});

  for (const {package: packageData, reason} of plan.keep) {
    if (reason === 'unknown GitHub repository') {
      core.warning(`Keeping ${packageLabel(packageData)}: ${reason}.`);
    }
  }

  for (const {package: packageData} of plan.remove) {
    const identifier = packageData.identifier_perm ?? packageData.slug_perm;
    if (dryRun) {
      core.info(`[dry-run] Delete ${packageLabel(packageData)} (${identifier}).`);
    } else {
      core.info(`Deleting ${packageLabel(packageData)} (${identifier}).`);
      await deleteCloudsmithPackage({owner, repository, token, identifier});
    }
  }

  const unknownNames = new Set(
    packages
      .map(({name}) => String(name).toLowerCase())
      .filter((name) => !knownNames.has(name)),
  );
  await core.summary
    .addHeading(`Cloudsmith ${owner}/${repository} cleanup`, 2)
    .addTable([
      [{data: 'Mode', header: true}, {data: dryRun ? 'Dry run' : 'Delete'}],
      [{data: 'Packages scanned', header: true}, {data: String(packages.length)}],
      [{data: 'Packages retained', header: true}, {data: String(plan.keep.length)}],
      [{data: 'Packages selected', header: true}, {data: String(plan.remove.length)}],
      [{data: 'Unknown package names', header: true}, {data: String(unknownNames.size)}],
    ])
    .write();

  return {
    scanned: packages.length,
    retained: plan.keep.length,
    selected: plan.remove.length,
  };
}
