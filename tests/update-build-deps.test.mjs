import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/__update-build-deps.yml', 'utf8').replaceAll('\r\n', '\n');
const assetStep = workflow.split('      - name: Update build-deps release assets\n')[1]
  .split('      - name: Create/Update Pull Request\n')[0];
const script = assetStep.split('          script: |\n')[1]
  .trimEnd().split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const executeScript = new AsyncFunction('github', 'context', 'core', 'require', 'process', script);
const tag = 'v2026.1004.34232';
const flatpakPath = 'repo/packaging/linux/flatpak/modules/ffmpeg.json';

function source(name, arch) {
  const entry = {
    type: 'file',
    url: `https://github.com/LizardByte/build-deps/releases/download/v2026.910.121303/${name}`,
    sha256: '0'.repeat(64),
    'dest-filename': 'ffmpeg.tar.gz',
    'x-checker-data': {'type': 'json', 'version-query': '.tag_name'},
  };
  if (arch) entry['only-arches'] = [arch];
  return entry;
}

function releaseFor(sources) {
  return {
    tag_name: tag,
    body: 'Release notes\n\nWith multiple lines.',
    assets: sources.map(entry => {
      const name = new URL(entry.url).pathname.split('/').pop();
      return {
        name,
        browser_download_url: `https://github.com/LizardByte/build-deps/releases/download/${tag}/${name}`,
        digest: `sha256:${'A'.repeat(64)}`,
      };
    }),
  };
}

function harness(manifests, release, requestedTag = tag) {
  const files = new Map(Object.entries(manifests).map(([path, manifest]) => [path, JSON.stringify(manifest)]));
  const writes = [];
  const requests = [];
  const outputs = {};
  const github = {rest: {repos: {
    async getReleaseByTag(options) {
      requests.push({method: 'tag', ...options});
      return {data: release};
    },
    async getLatestRelease(options) {
      requests.push({method: 'latest', ...options});
      return {data: release};
    },
  }}};
  const fakeFs = {
    existsSync: path => files.has(path),
    readFileSync: path => files.get(path),
    writeFileSync(path, content) {
      writes.push(path);
      files.set(path, content);
    },
  };
  return {
    files, writes, requests, outputs,
    run: () => executeScript(github, {repo: {owner: 'LizardByte'}}, {
      setOutput: (name, value) => { outputs[name] = value; },
    }, name => {
      assert.equal(name, 'fs');
      return fakeFs;
    }, {env: {BUILD_DEPS_VERSION: requestedTag}}),
  };
}

for (const consumer of ['Sunshine', 'Koko']) {
  test(`${consumer} refreshes its Flatpak sources for the selected submodule tag and preserves metadata`, async () => {
    const sources = [source('Linux-x86_64-ffmpeg.tar.gz', 'x86_64'), source('Linux-aarch64-ffmpeg.tar.gz', 'aarch64')];
    const manifest = {name: 'ffmpeg-prebuilt', 'build-commands': ['tar -xzf ffmpeg.tar.gz'], sources};
    const release = releaseFor(sources);
    const run = harness({[flatpakPath]: manifest}, release, tag);
    await run.run();
    const updated = JSON.parse(run.files.get(flatpakPath));
    assert.deepEqual(run.requests, [{method: 'tag', owner: 'LizardByte', repo: 'build-deps', tag}]);
    assert.equal(run.outputs.version, tag);
    assert.equal(run.outputs.updated, 'true');
    assert.equal(run.outputs.body, release.body);
    assert.deepEqual(updated['build-commands'], manifest['build-commands']);
    updated.sources.forEach((entry, index) => {
      assert.equal(entry.url, release.assets[index].browser_download_url);
      assert.equal(entry.sha256, 'a'.repeat(64));
      assert.deepEqual(entry['only-arches'], sources[index]['only-arches']);
      assert.deepEqual(entry['x-checker-data'], sources[index]['x-checker-data']);
      assert.equal(entry['dest-filename'], 'ffmpeg.tar.gz');
    });
  });
}

test('One updates its submodule without requiring a Flatpak or native release inventory', async () => {
  const release = releaseFor([]);
  const run = harness({}, release);
  await run.run();
  assert.deepEqual(run.requests, [{method: 'tag', owner: 'LizardByte', repo: 'build-deps', tag}]);
  assert.equal(run.outputs.version, tag);
  assert.equal(run.outputs.body, release.body);
  assert.equal(run.outputs.updated, 'false');
  assert.deepEqual(run.writes, []);
});

test('a missing submodule tag cannot fall back to the latest release', async () => {
  const run = harness({}, releaseFor([]), '');
  await assert.rejects(run.run(), /No build-deps submodule release tag/);
  assert.deepEqual(run.requests, []);
  assert.deepEqual(run.writes, []);
});

test('release metadata must match the selected submodule tag', async () => {
  const release = {...releaseFor([]), tag_name: 'v2026.1005.10000'};
  const run = harness({}, release);
  await assert.rejects(run.run(), /Expected release/);
  assert.deepEqual(run.writes, []);
});

for (const problem of ['missing asset', 'duplicate asset', 'invalid digest', 'empty assets']) {
  test(`${problem} responses leave every manifest unchanged`, async () => {
    const flatpakSources = [
      source('Linux-x86_64-ffmpeg.tar.gz', 'x86_64'), source('Linux-aarch64-ffmpeg.tar.gz', 'aarch64'),
    ];
    const release = releaseFor(flatpakSources);
    if (problem === 'missing asset') release.assets.pop();
    if (problem === 'duplicate asset') release.assets.push({...release.assets.at(-1)});
    if (problem === 'invalid digest') release.assets.at(-1).digest = `sha256:${'a'.repeat(64)}:extra`;
    if (problem === 'empty assets') release.assets = [];
    const run = harness({[flatpakPath]: {sources: flatpakSources}}, release);
    const original = new Map(run.files);
    await assert.rejects(run.run());
    assert.deepEqual(run.writes, []);
    assert.deepEqual(run.files, original);
  });
}

test('a missing Flatpak architecture fails before rewriting its pins', async () => {
  const sources = [source('Linux-x86_64-ffmpeg.tar.gz', 'x86_64')];
  const run = harness({[flatpakPath]: {sources}}, releaseFor(sources), tag);
  await assert.rejects(run.run(), /Expected one Flatpak FFmpeg source for aarch64/);
  assert.deepEqual(run.writes, []);
});

test('an already current manifest is not changed by another updater run', async () => {
  const sources = [source('Linux-x86_64-ffmpeg.tar.gz', 'x86_64'), source('Linux-aarch64-ffmpeg.tar.gz', 'aarch64')];
  const run = harness({[flatpakPath]: {sources}}, releaseFor(sources), tag);
  await run.run();
  const first = run.files.get(flatpakPath);
  await run.run();
  assert.equal(run.files.get(flatpakPath), first);
  assert.equal(run.outputs.updated, 'false');
  assert.deepEqual(run.writes, [flatpakPath]);
});
