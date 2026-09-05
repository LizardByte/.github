import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
  constants as fsConstants,
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const SOURCE_OWNER = 'LizardByte';
const CLOUDSMITH_DESTINATION = 'lizardbyte/stable';

const UBUNTU_2004_UNLABELED_DEB_RELEASES = new Set(['0.14.0', '0.14.1', '0.15.0']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function packageNames(repository) {
  if (!/^[0-9A-Za-z][0-9A-Za-z+._-]*$/.test(repository)) {
    throw new Error(`Unsupported repository name: ${repository}`);
  }
  const deb = repository.toLowerCase();
  if (!/^[a-z0-9][a-z0-9+.-]+$/.test(deb)) {
    throw new Error(`${repository} cannot be converted to a valid Debian package name.`);
  }
  return {deb, rpm: repository};
}

/**
 * Determine whether rpmrebuild would attempt an unsupported setarch call.
 *
 * rpmrebuild uses setarch when the package and runner architectures differ,
 * even though rebuilding an existing payload does not execute target binaries.
 *
 * @param {string} hostArchitecture Runner architecture.
 * @param {string} packageArchitecture RPM architecture.
 * @returns {boolean} Whether to bypass rpmrebuild's setarch invocation.
 */
export function requiresSetarchBypass(hostArchitecture, packageArchitecture) {
  return packageArchitecture !== hostArchitecture
    && packageArchitecture !== 'noarch'
    && packageArchitecture !== '(none)';
}

/**
 * Create the temporary RPM build compatibility declaration for a cross-architecture repack.
 *
 * @param {string} hostArchitecture Runner architecture.
 * @param {string} packageArchitecture RPM architecture.
 * @returns {string} rpmrc contents.
 */
export function rpmBuildCompatibility(hostArchitecture, packageArchitecture) {
  return `buildarch_compat: ${hostArchitecture}: ${packageArchitecture} ${hostArchitecture} noarch\n`;
}

/**
 * Return a tag without Sunshine's leading v.
 *
 * @param {string} tag Release tag.
 * @returns {string} Package version.
 */
export function versionFromTag(tag) {
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  if (!/^[0-9][0-9A-Za-z.+~]*$/.test(version)) {
    throw new Error(`Unsupported release tag: ${tag}`);
  }
  return version;
}

/**
 * Select published stable releases, optionally limiting the result to one tag.
 *
 * @param {Array<object>} releases GitHub release objects.
 * @param {string} releaseTag Optional exact tag.
 * @returns {Array<object>} Stable releases in oldest-first order.
 */
export function selectStableReleases(releases, releaseTag = '') {
  const stable = releases.filter((release) => (
    !release.draft && !release.prerelease && release.published_at
  ));
  const selected = releaseTag
    ? stable.filter((release) => release.tag_name === releaseTag)
    : stable;

  if (releaseTag && selected.length !== 1) {
    throw new Error(`Tag ${releaseTag} is not a published stable release.`);
  }

  return selected.toSorted((left, right) => (
    Date.parse(left.published_at) - Date.parse(right.published_at)
  ));
}

/**
 * Infer a historical DEB's repository target from its release-asset filename.
 *
 * @param {string} assetName GitHub release asset name.
 * @param {string} tag Release tag.
 * @param {string} repository GitHub repository and package name.
 * @returns {{distro: string, release: string}} Cloudsmith target.
 */
export function classifyDeb(assetName, tag, repository = 'Sunshine') {
  const name = assetName.toLowerCase();
  const packageName = packageNames(repository).deb;
  const prefix = escapeRegExp(packageName);
  let match = name.match(new RegExp(`^${prefix}_[^_]+\\+(debian|ubuntu)([^_]+)_[^_]+\\.deb$`));
  if (match) {
    return {distro: match[1], release: match[2]};
  }

  match = name.match(new RegExp(`^${prefix}-(debian|ubuntu)-([a-z0-9.]+)-(?:amd64|arm64)\\.deb$`));
  if (match) {
    return {distro: match[1], release: match[2]};
  }

  match = name.match(new RegExp(`^${prefix}(?:[-_]?ubuntu)?[-_]?(\\d{2})[._-]?(\\d{2})\\.deb$`));
  if (match) {
    return {distro: 'ubuntu', release: `${match[1]}.${match[2]}`};
  }

  if (repository === 'Sunshine' && name === 'sunshine-debian.deb') {
    return {distro: 'debian', release: 'bullseye'};
  }

  const version = versionFromTag(tag);
  if (
    repository === 'Sunshine'
    && name === 'sunshine.deb'
    && UBUNTU_2004_UNLABELED_DEB_RELEASES.has(version)
  ) {
    return {distro: 'ubuntu', release: '20.04'};
  }

  throw new Error(`Cannot infer a DEB target for ${tag}/${assetName}.`);
}

/**
 * Infer a historical RPM's repository target from its release-asset filename.
 *
 * @param {string} assetName GitHub release asset name.
 * @param {string} repository GitHub repository and package name.
 * @returns {{distro: string, release: string, releaseSuffix: string, generic: boolean}} Cloudsmith target.
 */
export function classifyRpm(assetName, repository = 'Sunshine') {
  const name = assetName.toLowerCase();
  const packageName = packageNames(repository).deb;
  const prefix = escapeRegExp(packageName);
  let match = name.match(/\.fc(\d+)\.(?:x86_64|aarch64)\.rpm$/);
  if (!match) {
    match = name.match(new RegExp(`^${prefix}-fedora-(\\d+)-(?:amd64|arm64)\\.rpm$`));
  }
  if (match) {
    return {
      distro: 'fedora',
      release: match[1],
      releaseSuffix: `1.fc${match[1]}`,
      generic: false,
    };
  }

  match = name.match(/\.suse\.lp(\d{2})(\d)\.(?:x86_64|aarch64)\.rpm$/);
  if (match) {
    return {
      distro: 'opensuse',
      release: `${Number(match[1])}.${match[2]}`,
      releaseSuffix: `1.suse.lp${match[1]}${match[2]}`,
      generic: false,
    };
  }

  if (/\.suse\.tw\.(?:x86_64|aarch64)\.rpm$/.test(name)) {
    return {
      distro: 'opensuse',
      release: 'tumbleweed',
      releaseSuffix: '1.suse.tw',
      generic: false,
    };
  }

  if (name === `${packageName}.rpm`) {
    return {
      distro: 'any-distro',
      release: 'any-version',
      releaseSuffix: '1',
      generic: true,
    };
  }

  throw new Error(`Cannot infer an RPM target for ${assetName}.`);
}

/**
 * Construct the corrected Debian version.
 *
 * @param {string} tag Release tag.
 * @param {{distro: string, release: string}} target Distribution target.
 * @returns {string} Debian version.
 */
export function debianVersion(tag, target) {
  return `${versionFromTag(tag)}-1+${target.distro}${target.release}`;
}

/**
 * Construct the canonical lowercase DEB filename.
 *
 * @param {string} version Embedded Debian version.
 * @param {string} architecture Debian architecture.
 * @param {string} packageName Lowercase Debian package name.
 * @returns {string} Canonical filename.
 */
export function canonicalDebFilename(version, architecture, packageName = 'sunshine') {
  return `${packageName}_${version}_${architecture}.deb`;
}

/**
 * Construct the canonical, case-sensitive RPM filename.
 *
 * @param {string} version Embedded RPM version.
 * @param {string} release Embedded RPM release.
 * @param {string} architecture RPM architecture.
 * @param {string} packageName Case-sensitive RPM package name.
 * @returns {string} Canonical filename.
 */
export function canonicalRpmFilename(version, release, architecture, packageName = 'Sunshine') {
  return `${packageName}-${version}-${release}.${architecture}.rpm`;
}

/**
 * Replace required fields in a Debian control file.
 *
 * @param {string} control Existing control text.
 * @param {{Package: string, Version: string}} fields Replacement fields.
 * @returns {string} Corrected control text.
 */
export function replaceDebControlFields(control, fields) {
  let corrected = control;
  for (const [field, value] of Object.entries(fields)) {
    const expression = new RegExp(`^${field}:.*$`, 'm');
    if (!expression.test(corrected)) {
      throw new Error(`DEB control file is missing ${field}.`);
    }
    corrected = corrected.replace(expression, `${field}: ${value}`);
  }
  return corrected;
}

function command(executable, args, options = {}) {
  const output = execFileSync(executable, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  return typeof output === 'string' ? output.trim() : '';
}

async function sha256File(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function downloadAsset(asset, destination, token) {
  const response = await fetch(asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'LizardByte-Cloudsmith-backfill',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${asset.name}: HTTP ${response.status}.`);
  }

  const partial = `${destination}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, {flags: 'wx'}));
  const size = statSync(partial).size;
  if (size !== asset.size) {
    unlinkSync(partial);
    throw new Error(`Downloaded ${asset.name} is ${size} bytes; expected ${asset.size}.`);
  }
  renameSync(partial, destination);
}

function queryDeb(filename) {
  return {
    name: command('dpkg-deb', ['--field', filename, 'Package']),
    version: command('dpkg-deb', ['--field', filename, 'Version']),
    architecture: command('dpkg-deb', ['--field', filename, 'Architecture']),
  };
}

function queryRpm(filename) {
  const output = command('rpm', [
    '-qp',
    '--nosignature',
    '--qf',
    '%{NAME}\u001f%{VERSION}\u001f%{RELEASE}\u001f%{ARCH}',
    filename,
  ]);
  const [name, version, release, architecture] = output.split('\u001f');
  return {name, version, release, architecture};
}

function findFiles(directory, predicate) {
  const matches = [];
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findFiles(filename, predicate));
    } else if (entry.isFile() && predicate(filename)) {
      matches.push(filename);
    }
  }
  return matches;
}

export async function prepareDeb({source, destinationDirectory, release, target, repository = 'Sunshine'}) {
  const original = queryDeb(source);
  const names = packageNames(repository);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(original.architecture)) {
    throw new Error(`Unsupported Debian architecture: ${original.architecture}`);
  }
  const desired = {
    name: names.deb,
    version: debianVersion(release.tag_name, target),
    architecture: original.architecture,
  };
  const filename = path.join(
    destinationDirectory,
    canonicalDebFilename(desired.version, desired.architecture, names.deb),
  );
  if (existsSync(filename)) {
    throw new Error(`Two assets normalize to ${path.basename(filename)}.`);
  }

  const rebuilt = original.name !== desired.name || original.version !== desired.version;
  if (rebuilt) {
    const extractDirectory = `${source}.root`;
    try {
      command('dpkg-deb', ['--raw-extract', source, extractDirectory]);
      const controlFile = path.join(extractDirectory, 'DEBIAN', 'control');
      const control = readFileSync(controlFile, 'utf8');
      writeFileSync(controlFile, replaceDebControlFields(control, {
        Package: desired.name,
        Version: desired.version,
      }));
      for (const maintainerScript of ['config', 'postinst', 'postrm', 'preinst', 'prerm']) {
        const scriptFile = path.join(extractDirectory, 'DEBIAN', maintainerScript);
        if (existsSync(scriptFile)) {
          chmodSync(scriptFile, 0o755);
        }
      }
      command('dpkg-deb', [
        '--root-owner-group',
        '-Zxz',
        '--build',
        extractDirectory,
        filename,
      ], {
        env: {
          ...process.env,
          SOURCE_DATE_EPOCH: String(Math.floor(Date.parse(release.published_at) / 1000)),
        },
      });
    } finally {
      rmSync(extractDirectory, {recursive: true, force: true});
    }
  } else {
    copyFileSync(source, filename, fsConstants.COPYFILE_EXCL);
  }

  command('dpkg-deb', ['--info', filename], {stdio: 'ignore'});
  command('dpkg-deb', ['--contents', filename], {stdio: 'ignore'});
  const normalized = queryDeb(filename);
  if (JSON.stringify(normalized) !== JSON.stringify(desired)) {
    throw new Error(`Rebuilt DEB metadata is invalid for ${path.basename(filename)}.`);
  }

  return {filename, original, normalized, rebuilt};
}

export async function prepareRpm({source, destinationDirectory, release, target, repository = 'Sunshine'}) {
  command('rpm', ['--checksig', '--nosignature', source]);
  const original = queryRpm(source);
  const names = packageNames(repository);
  if (!/^(?:aarch64|x86_64)$/.test(original.architecture)) {
    throw new Error(`Unsupported RPM architecture: ${original.architecture}`);
  }
  const desired = {
    name: names.rpm,
    version: versionFromTag(release.tag_name),
    release: target.releaseSuffix,
    architecture: original.architecture,
  };
  const filename = path.join(
    destinationDirectory,
    canonicalRpmFilename(desired.version, desired.release, desired.architecture, names.rpm),
  );
  if (existsSync(filename)) {
    throw new Error(`Two assets normalize to ${path.basename(filename)}.`);
  }

  const rebuilt = original.name !== desired.name
    || original.version !== desired.version
    || original.release !== desired.release;
  if (rebuilt) {
    const rebuildDirectory = `${source}.rpmrebuild`;
    mkdirSync(rebuildDirectory, {recursive: true});
    try {
      const rebuildEnvironment = {
        ...process.env,
        SOURCE_DATE_EPOCH: String(Math.floor(Date.parse(release.published_at) / 1000)),
      };
      const hostArchitecture = command('uname', ['-m']);
      if (requiresSetarchBypass(hostArchitecture, original.architecture)) {
        const toolDirectory = path.join(rebuildDirectory, 'bin');
        const setarch = path.join(toolDirectory, 'setarch');
        mkdirSync(toolDirectory, {recursive: true});
        writeFileSync(setarch, '#!/bin/sh\nshift\nexec "$@"\n');
        chmodSync(setarch, 0o755);
        rebuildEnvironment.PATH = `${toolDirectory}${path.delimiter}${process.env.PATH}`;

        const rpmConfigurationHome = path.join(rebuildDirectory, 'rpm-config');
        const rpmConfigurationDirectory = path.join(rpmConfigurationHome, 'rpm');
        mkdirSync(rpmConfigurationDirectory, {recursive: true});
        writeFileSync(
          path.join(rpmConfigurationDirectory, 'rpmrc'),
          rpmBuildCompatibility(hostArchitecture, original.architecture),
        );
        rebuildEnvironment.XDG_CONFIG_HOME = rpmConfigurationHome;
      }
      const filter = [
        'sed',
        `-e "s/^Name:.*/Name: ${desired.name}/"`,
        `-e "s/^Version:.*/Version: ${desired.version}/"`,
        `-e "s/^Release:.*/Release: ${desired.release}/"`,
      ].join(' ');
      const rpmrebuildArguments = [
        '--package',
        '--batch',
        '--notest-install',
        `--directory=${rebuildDirectory}`,
        `--change-spec-preamble=${filter}`,
      ];
      if (requiresSetarchBypass(hostArchitecture, original.architecture)) {
        rpmrebuildArguments.push(`--additional=--target ${original.architecture}`);
      }
      rpmrebuildArguments.push(source);
      command('rpmrebuild', rpmrebuildArguments, {
        env: rebuildEnvironment,
        stdio: 'inherit',
      });
      const rebuiltFiles = findFiles(
        rebuildDirectory,
        (candidate) => candidate.endsWith('.rpm') && !candidate.endsWith('.src.rpm'),
      );
      if (rebuiltFiles.length !== 1) {
        throw new Error(`rpmrebuild produced ${rebuiltFiles.length} binary RPMs for ${source}.`);
      }
      copyFileSync(rebuiltFiles[0], filename, fsConstants.COPYFILE_EXCL);
    } finally {
      rmSync(rebuildDirectory, {recursive: true, force: true});
    }
  } else {
    copyFileSync(source, filename, fsConstants.COPYFILE_EXCL);
  }

  command('rpm', ['--checksig', '--nosignature', filename]);
  const normalized = queryRpm(filename);
  if (JSON.stringify(normalized) !== JSON.stringify(desired)) {
    throw new Error(`Rebuilt RPM metadata is invalid for ${path.basename(filename)}.`);
  }

  if (rebuilt && original.name === 'sunshine') {
    const provides = command('rpm', ['-qp', '--provides', filename]).split('\n');
    if (!provides.some((item) => item.startsWith('sunshine = '))) {
      throw new Error('Rebuilt RPM no longer provides the historical sunshine package name.');
    }
  }

  return {filename, original, normalized, rebuilt};
}

/**
 * Download, validate, correct, and stage Sunshine's stable historical packages.
 *
 * @param {object} options Runtime options supplied by actions/github-script.
 * @returns {Promise<Array<object>>} Audit manifest entries.
 */
export async function prepareBackfill({
  github,
  core,
  token,
  workspace,
  repository,
  releaseTag = '',
}) {
  packageNames(repository);
  if (!token) {
    throw new Error('A GitHub token is required to download release assets.');
  }
  const releases = await github.paginate(github.rest.repos.listReleases, {
    owner: SOURCE_OWNER,
    repo: repository,
    per_page: 100,
  });
  const selected = selectStableReleases(releases, releaseTag.trim());
  if (selected.length === 0) {
    throw new Error('No published stable Sunshine releases were found.');
  }

  const root = path.join(workspace, 'artifacts', 'cloudsmith');
  const downloads = path.join(root, 'downloads');
  const detected = path.join(root, 'detected');
  const generic = path.join(root, 'generic');
  const manifestFile = path.join(root, 'manifest.json');
  for (const directory of [downloads, detected, generic]) {
    mkdirSync(directory, {recursive: true});
  }

  const manifest = [];
  for (const release of selected) {
    const assets = release.assets.filter((asset) => /\.(?:deb|rpm)$/i.test(asset.name));
    if (assets.length === 0) {
      core.info(`${release.tag_name}: no DEB or RPM assets`);
      continue;
    }

    core.startGroup(`${release.tag_name}: ${assets.length} package assets`);
    try {
      const releaseDirectory = path.join(downloads, release.tag_name.replace(/[^0-9A-Za-z_.-]/g, '_'));
      mkdirSync(releaseDirectory, {recursive: true});
      for (const asset of assets) {
        const safeName = path.basename(asset.name);
        if (safeName !== asset.name) {
          throw new Error(`Unsafe release asset name: ${asset.name}`);
        }
        const source = path.join(releaseDirectory, safeName);
        core.info(`Downloading ${release.tag_name}/${asset.name}`);
        await downloadAsset(asset, source, token);
        const sourceSha256 = await sha256File(source);
        if (asset.digest?.startsWith('sha256:') && asset.digest.slice(7) !== sourceSha256) {
          throw new Error(`GitHub digest mismatch for ${release.tag_name}/${asset.name}.`);
        }

        try {
          const isDeb = asset.name.toLowerCase().endsWith('.deb');
          const target = isDeb
            ? classifyDeb(asset.name, release.tag_name, repository)
            : classifyRpm(asset.name, repository);
          const prepared = isDeb
            ? await prepareDeb({source, destinationDirectory: detected, release, target, repository})
            : await prepareRpm({
              source,
              destinationDirectory: target.generic ? generic : detected,
              release,
              target,
              repository,
            });
          const stagedSha256 = await sha256File(prepared.filename);
          manifest.push({
            release: {
              tag: release.tag_name,
              publishedAt: release.published_at,
              repository: `${SOURCE_OWNER}/${repository}`,
            },
            source: {
              assetId: asset.id,
              name: asset.name,
              size: asset.size,
              githubDigest: asset.digest ?? null,
              sha256: sourceSha256,
              metadata: prepared.original,
            },
            staged: {
              name: path.basename(prepared.filename),
              size: statSync(prepared.filename).size,
              sha256: stagedSha256,
              metadata: prepared.normalized,
              rebuilt: prepared.rebuilt,
            },
            cloudsmith: {
              destination: `${CLOUDSMITH_DESTINATION}/${target.distro}/${target.release}`,
              automaticUpload: !target.generic,
            },
          });
          writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
        } finally {
          unlinkSync(source);
        }
      }
    } finally {
      core.endGroup();
    }
  }

  if (manifest.length === 0) {
    throw new Error('No stable DEB or RPM assets were staged.');
  }
  core.info(`Staged and validated ${manifest.length} packages.`);
  core.setOutput('package_count', manifest.length);
  core.setOutput('manifest', manifestFile);
  return manifest;
}

/**
 * Upload the old distro-neutral RPMs after the shared action configures the CLI.
 *
 * @param {object} options Runtime options supplied by actions/github-script.
 * @returns {Promise<number>} Number of generic RPMs found.
 */
export async function uploadGenericRpms({core, directory, publish, republish}) {
  const packages = existsSync(directory)
    ? readdirSync(directory)
      .filter((name) => name.endsWith('.rpm'))
      .toSorted()
      .map((name) => path.join(directory, name))
    : [];

  for (const filename of packages) {
    const args = [
      'push',
      'rpm',
      `${CLOUDSMITH_DESTINATION}/any-distro/any-version`,
      filename,
      '--no-wait-for-sync',
    ];
    if (republish) {
      args.push('--republish');
    }
    if (publish) {
      command('cloudsmith', args, {stdio: 'inherit'});
    } else {
      core.info(`[dry-run] cloudsmith ${args.join(' ')}`);
    }
  }
  core.info(`${publish ? 'Published' : 'Planned'} ${packages.length} distro-neutral RPMs.`);
  return packages.length;
}
