import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

import {requestGitLab} from '../.github/scripts/gitlab-request.mjs';

function harness(responses) {
  const calls = [];
  const delays = [];
  const messages = [];
  const options = {
    token: 'gitlab-test-token', githubToken: 'github/test-token', now: () => Date.parse('2026-11-09T00:00:00Z'),
    sleep: async delay => { delays.push(delay); }, log: message => messages.push(message),
    fetchImpl: async (url, init) => {
      calls.push({url, ...init});
      const response = responses.shift();
      assert.ok(response, 'Unexpected extra request');
      if (response instanceof Error) throw response;
      return response;
    },
  };
  return {calls, delays, messages, options};
}

test('plain-text 429 responses retry before parsing, preserving POST body and authentication', async () => {
  const run = harness([
    new Response('Rate limit exceeded', {status: 429, headers: {'Retry-After': '90'}}),
    new Response('{"id":42}', {status: 201}),
  ]);
  const body = {namespace_id: 2, visibility: 'private'};
  const result = await requestGitLab('POST', '/api/v4/projects', {...run.options, body});
  assert.equal(result.status, 201);
  assert.deepEqual(result.data, {id: 42});
  assert.deepEqual(run.delays, [90000]);
  assert.equal(run.calls.length, 2);
  for (const call of run.calls) {
    assert.equal(call.url, 'https://gitlab.com/api/v4/projects');
    assert.equal(call.method, 'POST');
    assert.equal(call.body, JSON.stringify(body));
    assert.equal(call.headers['PRIVATE-TOKEN'], run.options.token);
    assert.equal(call.redirect, 'manual');
  }
});

test('Retry-After dates and omitted or invalid headers use bounded exponential backoff', async () => {
  for (const [header, expected] of [
    ['Mon, 09 Nov 2026 00:02:00 GMT', 120000], ['', 15000], ['invalid', 15000], ['0', 15000],
  ]) {
    const run = harness([new Response('throttled', {status: 429, headers: {'Retry-After': header}}),
      new Response('{}', {status: 200})]);
    await requestGitLab('GET', '/api/v4/groups/1', run.options);
    assert.deepEqual(run.delays, [expected]);
  }
});

test('persistent throttling exhausts five attempts with an HTTP error instead of a JSON error', async () => {
  const run = harness(Array.from({length: 5}, () => new Response('Rate limit exceeded', {status: 429})));
  const result = await requestGitLab('GET', '/api/v4/projects/42', run.options);
  assert.equal(result.status, 429);
  assert.deepEqual(run.delays, [15000, 30000, 60000, 120000]);
  assert.equal(run.calls.length, 5);
  assert.match(result.diagnostic, /HTTP 429: Rate limit exceeded/);
});

test('long server cooldowns are reported without retrying before Retry-After expires', async () => {
  const run = harness([new Response('Daily limit exceeded', {status: 429, headers: {'Retry-After': '86400'}})]);
  assert.equal((await requestGitLab('POST', '/api/v4/projects', run.options)).status, 429);
  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.delays, []);
  assert.match(run.messages[0], /will not be retried/);
});

test('metadata 404s report GitLab details and request IDs without retrying or recreating projects', async () => {
  const run = harness([new Response('{"message":"404 Project Not Found"}', {
    status: 404, headers: {'x-request-id': 'request-123'},
  })]);
  const result = await requestGitLab('PUT', '/api/v4/projects/42', {...run.options, body: {visibility: 'private'}});
  assert.equal(result.status, 404);
  assert.equal(run.calls.length, 1);
  assert.match(run.messages[0], /PUT \/api\/v4\/projects\/42 returned HTTP 404 \(request ID request-123\): 404 Project Not Found/);
  assert.deepEqual(run.delays, []);
});

test('expected missing-project lookups remain available to provisioning without error log noise', async () => {
  const run = harness([new Response('{"message":"404 Project Not Found"}', {status: 404})]);
  assert.equal((await requestGitLab('GET', '/api/v4/projects/new', run.options)).status, 404);
  assert.deepEqual(run.messages, []);
});

test('other HTTP errors and ambiguous network failures do not replay mutations', async () => {
  for (const status of [401, 403, 409, 500, 503]) {
    const run = harness([new Response('Error response', {status})]);
    assert.equal((await requestGitLab('POST', '/api/v4/projects', run.options)).status, status);
    assert.equal(run.calls.length, 1);
    assert.deepEqual(run.delays, []);
  }
  const run = harness([new Error('Connection reset')]);
  await assert.rejects(requestGitLab('POST', '/api/v4/projects', run.options), /Connection reset/);
  assert.equal(run.calls.length, 1);
});

test('error diagnostics are bounded and redact tokens, encoded tokens, credential URLs, and newlines', async () => {
  const body = 'gitlab-test-token github/test-token github%2Ftest-token\n' +
    'https://user:password@example.com/import?token=another-secret ' + 'x'.repeat(1000);
  const run = harness([new Response(body, {status: 404})]);
  const result = await requestGitLab('PUT', '/api/v4/projects/42', run.options);
  assert.equal(result.text, body);
  assert.match(run.messages[0], /\[REDACTED\]/);
  assert.match(run.messages[0], /\[URL\]/);
  assert.doesNotMatch(run.messages[0], /gitlab-test-token|github.test-token|github%2Ftest-token|password|another-secret|\n/);
  assert.ok(run.messages[0].length < 500);
});

test('successful non-JSON responses fail clearly without logging their contents', async () => {
  const run = harness([new Response('sensitive success body', {status: 200})]);
  await assert.rejects(requestGitLab('GET', '/api/v4/projects/42', run.options), /non-JSON response \(HTTP 200\)/);
  assert.deepEqual(run.messages, []);
});

test('request validation prevents credentials from reaching other hosts or redirect destinations', async () => {
  const run = harness([]);
  for (const path of ['https://example.com/api/v4/projects', 'https://user:password@gitlab.com/api/v4/projects',
    '/api/v4/../../elsewhere', '/not-api']) {
    await assert.rejects(requestGitLab('GET', path, run.options), /Invalid GitLab API request target/);
  }
  await assert.rejects(requestGitLab('DELETE', '/api/v4/projects/42', run.options), /Invalid GitLab API request target/);
  assert.deepEqual(run.calls, []);
});

test('the CLI rejects arguments and invalid API origins before issuing a request', () => {
  const path = '.github/scripts/gitlab-request.mjs';
  const args = spawnSync(process.execPath, [path, '../output'], {encoding: 'utf8'});
  assert.equal(args.status, 1);
  assert.match(args.stderr, /does not accept CLI arguments/);
  const origin = spawnSync(process.execPath, [path], {
    encoding: 'utf8', input: '{}', env: {...process.env, GITLAB_REQUEST_METHOD: 'GET',
      GITLAB_REQUEST_URL: 'https://example.com/api/v4/projects', GITLAB_TOKEN: 'test-token'},
  });
  assert.equal(origin.status, 1);
  assert.match(origin.stderr, /Invalid GitLab API request target/);
  assert.equal(origin.stdout, '');
  assert.doesNotMatch(origin.stderr, /test-token/);
});

test('the shell-facing CLI emits only its response envelope on stdout and redacted diagnostics on stderr', () => {
  const code = `
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://gitlab.com/api/v4/projects/42' || options.body !== '{"visibility":"private"}') {
        throw new Error('Request changed in transit');
      }
      return new Response('{"message":"404 Project Not Found: test-token"}', {
        status: 404, headers: {'x-request-id': 'request-cli'},
      });
    };
    process.argv[1] = '.github/scripts/gitlab-request.mjs';
    await import('./.github/scripts/gitlab-request.mjs');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', input: '{"visibility":"private"}\n', env: {...process.env,
      GITLAB_REQUEST_METHOD: 'PUT', GITLAB_REQUEST_URL: 'https://gitlab.com/api/v4/projects/42', GITLAB_TOKEN: 'test-token'},
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {status: 404, body: '{"message":"404 Project Not Found: test-token"}'});
  assert.match(result.stderr, /request ID request-cli/);
  assert.match(result.stderr, /404 Project Not Found: \[REDACTED\]/);
  assert.doesNotMatch(result.stderr, /test-token/);
});
