import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import JSON5 from 'json5';
import {api as condaVersioning} from 'renovate/dist/modules/versioning/conda/index.js';
import {extractPackageFile as extractCdnUrlPackageFile} from 'renovate/dist/modules/manager/cdnurl/index.js';
import {extractPackageFile as extractRegexPackageFile} from 'renovate/dist/modules/manager/custom/regex/index.js';
import {compile} from 'renovate/dist/util/template/index.js';

const renovateConfig = JSON5.parse(fs.readFileSync('renovate-config.json5', 'utf8'));
const githubRefManager = renovateConfig.customManagers.find(
  manager => manager.description === 'Update annotated GitHub values and their jsDelivr commits',
);
const jekyllNpmCdnManager = renovateConfig.customManagers.find(
  manager => manager.datasourceTemplate === 'npm'
    && manager.managerFilePatterns.some(pattern => pattern.includes('gh-pages-template')),
);
const sourceNpmCdnManager = renovateConfig.customManagers.find(
  manager => manager.datasourceTemplate === 'npm'
    && manager.managerFilePatterns.some(pattern => pattern.includes('docs/source/conf')),
);
const condaEnvironmentManager = renovateConfig.customManagers.find(
  manager => manager.datasourceTemplate === 'conda'
    && manager.managerFilePatterns.some(pattern => pattern.includes('environment')),
);

function matchesManagerFilePattern(fileName, patterns) {
  return patterns.some(pattern => {
    const closingSlash = pattern.lastIndexOf('/');
    assert.equal(pattern[0], '/', `Expected a regex managerFilePattern: ${pattern}`);
    assert.ok(closingSlash > 0, `Expected a closing slash in managerFilePattern: ${pattern}`);

    return new RegExp(pattern.slice(1, closingSlash), pattern.slice(closingSlash + 1)).test(fileName);
  });
}

function extractNpmDependencies(manager, fileName, content) {
  assert.ok(manager, 'Expected to find the npm CDN custom manager');
  assert.ok(
    matchesManagerFilePattern(fileName, manager.managerFilePatterns),
    `Expected the npm CDN manager to scan ${fileName}`,
  );

  return extractRegexPackageFile(content, fileName, manager)?.deps ?? [];
}

function extractGitHubRefDependencies(fileName, content) {
  assert.ok(githubRefManager, 'Expected to find the annotated GitHub ref custom manager');
  assert.ok(
    matchesManagerFilePattern(fileName, githubRefManager.managerFilePatterns),
    `Expected the annotated GitHub ref manager to scan ${fileName}`,
  );

  const dependencies = extractRegexPackageFile(content, fileName, githubRefManager)?.deps ?? [];
  return dependencies.map(dependency => ({
    currentDigest: dependency.currentDigest,
    currentValue: dependency.currentValue,
    datasource: dependency.datasource,
    depName: dependency.depName,
    versioning: dependency.versioning,
  }));
}

function extractCondaDependencies(fileName, content) {
  assert.ok(condaEnvironmentManager, 'Expected to find the Conda environment custom manager');
  assert.ok(
    matchesManagerFilePattern(fileName, condaEnvironmentManager.managerFilePatterns),
    `Expected the Conda environment manager to scan ${fileName}`,
  );

  return extractRegexPackageFile(content, fileName, condaEnvironmentManager)?.deps ?? [];
}

test('extracts the actionlint release and jsDelivr commit', () => {
  const fileName = '.github/workflows/__call-common-lint.yml';
  const content = fs.readFileSync(fileName, 'utf8');
  assert.deepEqual(
    extractGitHubRefDependencies(fileName, content),
    [{
      currentDigest: '914e7df21a07ef503a81201c76d2b11c789d3fca',
      currentValue: 'v1.7.12',
      datasource: 'github-tags',
      depName: 'rhysd/actionlint',
      versioning: 'semver',
    }],
  );
});

test('extracts a GitHub branch and jsDelivr commit from a composite action', () => {
  const fileName = 'actions/setup_python/action.yml';
  const content = `
        # renovate: datasource=github-digest depName=pyenv/pyenv-installer versioning=exact
        pyenv_installer_branch="master"
        pyenv_installer_ref="63a9e6a216796aeba2535a3bac8e79ba5d95166d"
  `;
  assert.deepEqual(
    extractGitHubRefDependencies(fileName, content),
    [{
      currentDigest: '63a9e6a216796aeba2535a3bac8e79ba5d95166d',
      currentValue: 'master',
      datasource: 'github-digest',
      depName: 'pyenv/pyenv-installer',
      versioning: 'exact',
    }],
  );
});

test('extracts and updates pinned conda-forge dependencies from environment files', () => {
  const fileName = 'environment.yml';
  const content = `
---
name: RTD
channels:
  - conda-forge
  - defaults
dependencies:
  - doxygen=1.2.3
  - graphviz = 4.5.6  # Keep an inline comment.
  - nodejs
  - pip:
      - example==7.8.9
`;
  const dependencies = extractCondaDependencies(fileName, content);

  assert.deepEqual(
    dependencies.map(dependency => ({
      currentValue: dependency.currentValue,
      datasource: dependency.datasource,
      depName: dependency.depName,
      packageName: dependency.packageName,
      versioning: dependency.versioning,
    })),
    [
      {
        currentValue: '==1.2.3',
        datasource: 'conda',
        depName: 'doxygen',
        packageName: 'conda-forge/doxygen',
        versioning: 'conda',
      },
      {
        currentValue: '==4.5.6',
        datasource: 'conda',
        depName: 'graphviz',
        packageName: 'conda-forge/graphviz',
        versioning: 'conda',
      },
    ],
  );

  const dependency = dependencies[0];
  const currentVersion = dependency.currentValue.replace(/^==/, '');
  const newVersion = nextTestVersion(currentVersion);
  const newValue = condaVersioning.getNewValue({
    currentValue: dependency.currentValue,
    currentVersion,
    isReplacement: false,
    newVersion,
    rangeStrategy: 'replace',
  });
  const updatedReplaceString = compile(
    condaEnvironmentManager.autoReplaceStringTemplate,
    {...dependency, newValue, newVersion},
    false,
  );
  const updatedContent = content.replace(dependency.replaceString, updatedReplaceString);
  const updatedDependencies = extractCondaDependencies(fileName, updatedContent);

  assert.equal(updatedDependencies[0].currentValue, newValue);
  assert.match(updatedContent, new RegExp(`  - doxygen=${newVersion.replaceAll('.', '\\.')}`));
  assert.match(updatedContent, /  - graphviz = 4\.5\.6  # Keep an inline comment\./);
});

function nextTestVersion(currentValue) {
  const match = /^(.*?)(\d+)$/.exec(currentValue);
  assert.ok(match, `Expected a version ending in a number: ${currentValue}`);

  return `${match[1]}${BigInt(match[2]) + 1n}`;
}

function applyExtractedUpdate(content, dependency, newValue) {
  assert.ok(dependency.replaceString, 'Expected Renovate to provide a replaceString');
  const updatedReplaceString = dependency.replaceString.replace(dependency.currentValue, newValue);
  assert.notEqual(updatedReplaceString, dependency.replaceString);

  return content.replaceAll(dependency.replaceString, updatedReplaceString);
}

test('extracts versioned npm CDN URLs from supported file types', () => {
  const cases = [
    {
      fileName: 'docs/source/conf.py',
      content: `
html_css_files = [
    'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@1.2.3/dist/styles.css',
]
`,
      expected: [['@lizardbyte/shared-web', '1.2.3']],
    },
    {
      fileName: 'assets/js/projects.js',
      content: `
const sharedWeb = 'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@v2.3.4';
const icon = 'https://cdn.jsdelivr.net/npm/simple-icons@v15/icons/readthedocs.svg';
`,
      expected: [
        ['@lizardbyte/shared-web', 'v2.3.4'],
        ['simple-icons', 'v15'],
      ],
    },
    {
      fileName: 'apps/moonlight/client.json',
      content: '{"src":"https://cdn.jsdelivr.net/npm/simple-icons@13/icons/example.svg"}',
      expected: [['simple-icons', '13']],
    },
    {
      fileName: '_includes/commentbox.html',
      content: '<script src="https://unpkg.com/commentbox.io@2.1.0/dist/commentBox.min.js"></script>',
      expected: [['commentbox.io', '2.1.0']],
    },
  ];

  for (const {fileName, content, expected} of cases) {
    const actual = extractNpmDependencies(sourceNpmCdnManager, fileName, content).map(dependency => [
      dependency.depName,
      dependency.currentValue,
    ]);

    assert.deepEqual(actual, expected, fileName);
  }
});

test('extracts and can update every shared-web pin in this repository Sphinx config', () => {
  const fileName = 'docs/source/conf.py';
  const content = fs.readFileSync(fileName, 'utf8');
  const dependencies = extractNpmDependencies(
    sourceNpmCdnManager,
    fileName,
    content,
  ).filter(dependency => dependency.depName === '@lizardbyte/shared-web');

  const sourcePins = [...content.matchAll(
    /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@lizardbyte\/shared-web@(?<version>v?\d[^/"'\s?#]*)/g,
  )];
  assert.ok(sourcePins.length > 0, 'Expected at least one shared-web pin');
  assert.equal(dependencies.length, sourcePins.length, 'Expected Renovate to extract every shared-web pin');
  assert.deepEqual(
    dependencies.map(dependency => dependency.currentValue),
    sourcePins.map(pin => pin.groups.version),
  );

  const currentVersions = new Set(dependencies.map(dependency => dependency.currentValue));
  assert.equal(currentVersions.size, 1, 'Expected every shared-web URL to use the same version');
  const currentValue = dependencies[0].currentValue;
  const newValue = nextTestVersion(currentValue);
  const updatedContent = applyExtractedUpdate(content, dependencies[0], newValue);
  const updatedDependencies = extractNpmDependencies(
    sourceNpmCdnManager,
    fileName,
    updatedContent,
  );

  assert.equal(updatedDependencies.length, dependencies.length);
  assert.ok(updatedDependencies.every(dependency => dependency.currentValue === newValue));
});

test('ignores moving tags and interpolated npm CDN versions', () => {
  const dependencies = extractNpmDependencies(
    sourceNpmCdnManager,
    'assets/js/example.js',
    `
const latest = 'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@latest/dist/example.js';
const dynamic = \`https://cdn.jsdelivr.net/npm/@lizardbyte/gamepad-helper@\${gamepadHelperVersion}/example.js\`;
`,
  );

  assert.deepEqual(dependencies, []);
});

test('keeps commented Sphinx examples outside the selected Python path', () => {
  assert.equal(
    matchesManagerFilePattern('examples/sphinx/source/conf.py', sourceNpmCdnManager.managerFilePatterns),
    false,
  );
});

test('extracts npm CDN URLs from known Jekyll YAML keys', () => {
  const dependencies = extractNpmDependencies(
    jekyllNpmCdnManager,
    'gh-pages-template/_data/features.yml',
    'icon_img: "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.13.1/icons/windows.svg"',
  );

  assert.deepEqual(
    dependencies.map(dependency => [dependency.depName, dependency.currentValue]),
    [['bootstrap-icons', '1.13.1']],
  );
});

test('extracts cdnjs imports from asset stylesheets', () => {
  const fileName = 'docs/assets/css/style.css';
  assert.ok(matchesManagerFilePattern(fileName, renovateConfig.cdnurl.managerFilePatterns));

  const dependencies = extractCdnUrlPackageFile(
    "@import '//cdnjs.cloudflare.com/ajax/libs/normalize/3.0.1/normalize.min.css';",
    fileName,
  ).deps;

  assert.deepEqual(
    dependencies.map(dependency => [dependency.depName, dependency.currentValue]),
    [['normalize', '3.0.1']],
  );
});
