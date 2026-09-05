import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalDebFilename,
  canonicalRpmFilename,
  classifyDeb,
  classifyRpm,
  debianVersion,
  replaceDebControlFields,
  requiresSetarchBypass,
  rpmBuildCompatibility,
  selectStableReleases,
  versionFromTag,
} from '../.github/scripts/cloudsmith-backfill.mjs';

test('selectStableReleases excludes drafts and prereleases and sorts oldest first', () => {
  const releases = [
    {tag_name: 'v3.0.0', published_at: '2026-03-01T00:00:00Z', draft: false, prerelease: true},
    {tag_name: 'v2.0.0', published_at: '2026-02-01T00:00:00Z', draft: false, prerelease: false},
    {tag_name: 'v0.0.0', published_at: null, draft: true, prerelease: false},
    {tag_name: 'v1.0.0', published_at: '2026-01-01T00:00:00Z', draft: false, prerelease: false},
  ];

  assert.deepEqual(
    selectStableReleases(releases).map((release) => release.tag_name),
    ['v1.0.0', 'v2.0.0'],
  );
  assert.deepEqual(
    selectStableReleases(releases, 'v2.0.0').map((release) => release.tag_name),
    ['v2.0.0'],
  );
  assert.throws(
    () => selectStableReleases(releases, 'v3.0.0'),
    /not a published stable release/,
  );
});

test('versionFromTag accepts Sunshine versions and rejects unsafe tags', () => {
  assert.equal(versionFromTag('v0.17.0'), '0.17.0');
  assert.equal(versionFromTag('v2026.516.143833'), '2026.516.143833');
  assert.throws(() => versionFromTag('release/1.0'), /Unsupported release tag/);
});

test('classifyDeb covers every historical Sunshine naming generation', () => {
  const cases = [
    ['sunshine20.04.deb', 'v0.7.0', {distro: 'ubuntu', release: '20.04'}],
    ['sunshine21-04.deb', 'v0.7.1', {distro: 'ubuntu', release: '21.04'}],
    ['sunshine-2004.deb', 'v0.11.1', {distro: 'ubuntu', release: '20.04'}],
    ['sunshine-ubuntu_21_10.deb', 'v0.13.0', {distro: 'ubuntu', release: '21.10'}],
    ['sunshine-22.04.deb', 'v0.17.0', {distro: 'ubuntu', release: '22.04'}],
    ['sunshine-debian.deb', 'v0.10.1', {distro: 'debian', release: 'bullseye'}],
    ['sunshine.deb', 'v0.14.0', {distro: 'ubuntu', release: '20.04'}],
    ['sunshine-debian-bookworm-amd64.deb', 'v0.23.1', {distro: 'debian', release: 'bookworm'}],
    ['sunshine-ubuntu-24.04-arm64.deb', 'v2026.516.143833', {distro: 'ubuntu', release: '24.04'}],
    [
      'sunshine_2026.516.143833-1+debiantrixie_amd64.deb',
      'v2026.516.143833',
      {distro: 'debian', release: 'trixie'},
    ],
  ];

  for (const [filename, tag, expected] of cases) {
    assert.deepEqual(classifyDeb(filename, tag), expected, filename);
  }
  assert.throws(() => classifyDeb('sunshine.deb', 'v0.13.0'), /Cannot infer/);
});

test('classifyRpm covers Fedora, openSUSE, and distro-neutral packages', () => {
  assert.deepEqual(classifyRpm('sunshine-fedora-37-amd64.rpm'), {
    distro: 'fedora', release: '37', releaseSuffix: '1.fc37', generic: false,
  });
  assert.deepEqual(classifyRpm('Sunshine-2026.516.143833-1.fc44.aarch64.rpm'), {
    distro: 'fedora', release: '44', releaseSuffix: '1.fc44', generic: false,
  });
  assert.deepEqual(classifyRpm('Sunshine-2026.516.143833-1.suse.lp156.x86_64.rpm'), {
    distro: 'opensuse', release: '15.6', releaseSuffix: '1.suse.lp156', generic: false,
  });
  assert.deepEqual(classifyRpm('Sunshine-2026.516.143833-1.suse.tw.x86_64.rpm'), {
    distro: 'opensuse', release: 'tumbleweed', releaseSuffix: '1.suse.tw', generic: false,
  });
  assert.deepEqual(classifyRpm('sunshine.rpm'), {
    distro: 'any-distro', release: 'any-version', releaseSuffix: '1', generic: true,
  });
  assert.throws(() => classifyRpm('unknown.rpm'), /Cannot infer/);
});

test('explicit distro filenames work for another LizardByte repository', () => {
  assert.deepEqual(classifyDeb('helloworld-ubuntu-24.04-amd64.deb', 'v1.0.0', 'HelloWorld'), {
    distro: 'ubuntu', release: '24.04',
  });
  assert.deepEqual(classifyRpm('HelloWorld-1.0.0-1.fc44.x86_64.rpm', 'HelloWorld'), {
    distro: 'fedora', release: '44', releaseSuffix: '1.fc44', generic: false,
  });
  assert.equal(
    canonicalDebFilename('1.0.0-1+ubuntu24.04', 'amd64', 'helloworld'),
    'helloworld_1.0.0-1+ubuntu24.04_amd64.deb',
  );
  assert.equal(
    canonicalRpmFilename('1.0.0', '1.fc44', 'x86_64', 'HelloWorld'),
    'HelloWorld-1.0.0-1.fc44.x86_64.rpm',
  );
});

test('package names follow the native DEB and RPM conventions', () => {
  const target = {distro: 'ubuntu', release: '22.04'};
  const version = debianVersion('v0.17.0', target);
  assert.equal(version, '0.17.0-1+ubuntu22.04');
  assert.equal(canonicalDebFilename(version, 'amd64'), 'sunshine_0.17.0-1+ubuntu22.04_amd64.deb');
  assert.equal(canonicalRpmFilename('0.17.0', '1.fc37', 'x86_64'), 'Sunshine-0.17.0-1.fc37.x86_64.rpm');
});

test('replaceDebControlFields corrects package identity and version only', () => {
  const control = 'Package: Sunshine\nVersion: 0.7.3\nArchitecture: amd64\nDescription: Sunshine\n';
  assert.equal(
    replaceDebControlFields(control, {Package: 'sunshine', Version: '0.7.0-1+ubuntu20.04'}),
    'Package: sunshine\nVersion: 0.7.0-1+ubuntu20.04\nArchitecture: amd64\nDescription: Sunshine\n',
  );
  assert.throws(
    () => replaceDebControlFields('Package: sunshine\n', {Package: 'sunshine', Version: '1.0'}),
    /missing Version/,
  );
});

test('setarch is bypassed only for cross-architecture RPM rebuilds', () => {
  assert.equal(requiresSetarchBypass('x86_64', 'aarch64'), true);
  assert.equal(requiresSetarchBypass('x86_64', 'x86_64'), false);
  assert.equal(requiresSetarchBypass('x86_64', 'noarch'), false);
  assert.equal(requiresSetarchBypass('x86_64', '(none)'), false);
  assert.equal(
    rpmBuildCompatibility('x86_64', 'aarch64'),
    'buildarch_compat: x86_64: aarch64 x86_64 noarch\n',
  );
});
