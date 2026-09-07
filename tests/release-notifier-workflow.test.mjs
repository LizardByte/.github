import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/__call-release-notifier.yml', 'utf8');
const createBlogStart = workflow.indexOf('      - name: Create blog post');
const createBlogEnd = workflow.indexOf('      - name: Create/Update Pull Request', createBlogStart);
const createBlogStep = workflow.slice(createBlogStart, createBlogEnd);
const runScript = createBlogStep.slice(createBlogStep.indexOf('        run: |'));

test('create blog post does not interpolate release data into its shell script', () => {
  assert.notEqual(createBlogStart, -1);
  assert.notEqual(createBlogEnd, -1);

  assert.match(createBlogStep, /RELEASE_BODY: \$\{\{ github\.event\.release\.body \}\}/);
  assert.match(createBlogStep, /REPOSITORY: \$\{\{ github\.repository \}\}/);
  assert.match(createBlogStep, /REPOSITORY_NAME: \$\{\{ github\.event\.repository\.name \}\}/);
  assert.match(createBlogStep, /TAG_NAME: \$\{\{ github\.event\.release\.tag_name \}\}/);
  assert.doesNotMatch(runScript, /\$\{\{\s*github\./);
  assert.match(runScript, /printf '%s\\n' "\$\{RELEASE_BODY\}" >> "\$\{file_name\}"/);
});
