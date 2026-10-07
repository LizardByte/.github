import assert from 'node:assert/strict';
import test from 'node:test';

import {CleanupStopped, createCleanupRuntime} from '../.github/scripts/cleanup-runtime.mjs';

test('cleanup defaults to 5.5 hours and refuses to start further work at the deadline', async (t) => {
  let now = 0;
  const runtime = createCleanupRuntime({now: () => now});
  t.after(() => runtime.dispose());
  now = 5.5 * 60 * 60 * 1000 - 1;
  assert.equal(await runtime.run(async () => 'before deadline'), 'before deadline');
  now += 1;
  await assert.rejects(runtime.run(() => assert.fail('Work must not start')), CleanupStopped);
});

test('cleanup counts a confirmed operation even if it finishes at the deadline', async (t) => {
  let now = 0;
  const runtime = createCleanupRuntime({maxRuntimeMs: 1000, now: () => now});
  t.after(() => runtime.dispose());
  assert.equal(await runtime.run(async () => { now = 1000; return 'confirmed'; }), 'confirmed');
  assert.throws(() => runtime.check(), CleanupStopped);
});

test('cleanup aborts a pending HTTP request when its wall-clock budget expires', async (t) => {
  const runtime = createCleanupRuntime({maxRuntimeMs: 20});
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => { runtime.dispose(); clearTimeout(keepAlive); });
  let requestSignal;
  t.mock.method(globalThis, 'fetch', (url, {signal}) => {
    requestSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
  });
  await assert.rejects(runtime.fetch('https://registry.example/stalled'), CleanupStopped);
  assert.equal(requestSignal.aborted, true);
});

test('cleanup bounds a stalled Octokit request and passes its abort signal', async (t) => {
  const runtime = createCleanupRuntime({maxRuntimeMs: 20});
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => { runtime.dispose(); clearTimeout(keepAlive); });
  let requestSignal;
  const api = runtime.github({
    request(route, options) {
      assert.equal(options.request.retries, 0);
      requestSignal = options.request.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(api.request('DELETE /stalled', {request: {retries: 0}}), CleanupStopped);
  assert.equal(requestSignal.aborted, true);
});

test('cleanup stops pagination at the deadline without returning a partial inventory', async (t) => {
  let now = 0;
  const runtime = createCleanupRuntime({maxRuntimeMs: 1000, now: () => now});
  t.after(() => runtime.dispose());
  let pages = 0;
  const api = runtime.github({
    async paginate(route, options, mapPage) {
      assert.ok(options.request.signal instanceof AbortSignal);
      pages += 1;
      now = 1000;
      mapPage({data: ['partial']});
      pages += 1;
      return ['partial', 'more'];
    },
  });
  await assert.rejects(api.paginate('GET /pages'), CleanupStopped);
  assert.equal(pages, 1);
});
