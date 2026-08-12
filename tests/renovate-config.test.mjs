import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import JSON5 from 'json5';
import {extractPackageFile as extractCdnUrlPackageFile} from 'renovate/dist/modules/manager/cdnurl/index.js';
import {extractPackageFile as extractRegexPackageFile} from 'renovate/dist/modules/manager/custom/regex/index.js';

const renovateConfig = JSON5.parse(fs.readFileSync('renovate-config.json5', 'utf8'));
const jekyllNpmCdnManager = renovateConfig.customManagers.find(
  manager => manager.datasourceTemplate === 'npm'
    && manager.managerFilePatterns.some(pattern => pattern.includes('gh-pages-template')),
);
const sourceNpmCdnManager = renovateConfig.customManagers.find(
  manager => manager.datasourceTemplate === 'npm'
    && manager.managerFilePatterns.some(pattern => pattern.includes('docs/source/conf')),
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

test('extracts versioned npm CDN URLs from supported file types', () => {
  const cases = [
    {
      fileName: 'docs/source/conf.py',
      content: `
html_css_files = [
    'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@2026.314.32913/dist/styles.css',
]
`,
      expected: [['@lizardbyte/shared-web', '2026.314.32913']],
    },
    {
      fileName: 'assets/js/projects.js',
      content: `
const sharedWeb = 'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@v2026.726.204939';
const icon = 'https://cdn.jsdelivr.net/npm/simple-icons@v15/icons/readthedocs.svg';
`,
      expected: [
        ['@lizardbyte/shared-web', 'v2026.726.204939'],
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

test('extracts every shared-web pin from this repository Sphinx config', () => {
  const dependencies = extractNpmDependencies(
    sourceNpmCdnManager,
    'docs/source/conf.py',
    fs.readFileSync('docs/source/conf.py', 'utf8'),
  );

  assert.deepEqual(
    dependencies.map(dependency => [dependency.depName, dependency.currentValue]),
    [
      ['@lizardbyte/shared-web', '2026.314.32913'],
      ['@lizardbyte/shared-web', '2026.314.32913'],
      ['@lizardbyte/shared-web', '2026.314.32913'],
    ],
  );
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
