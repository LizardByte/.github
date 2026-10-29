import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/__mirror-github-to-gitlab.yml', 'utf8').replaceAll('\r\n', '\n');
const errorCommands = workflow.replaceAll(/\\\n */g, ' ').split('\n')
  .map(line => line.trim()).filter(line => /^echo .*"::error title=Mirror failed:/.test(line));
const bash = process.env.BASH || 'bash';

test('repository mirror failure annotations go to stderr with their context intact', async (t) => {
  assert.equal(errorCommands.length, 24);
  for (const command of errorCommands) {
    await t.test(command, () => {
      const result = spawnSync(bash, ['--noprofile', '--norc', '-euo', 'pipefail'], {
        input: command,
        encoding: 'utf8',
        env: {
          ...process.env,
          source_name: 'example repository',
          status: '503',
          import_status: 'unexpected',
          error_message: 'Unable to create the GitLab project (HTTP 503).',
          seed_ref: 'refs/heads/master',
        },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^::error title=Mirror failed: example repository::[^\r\n]+\r?\n$/);
    });
  }
});
