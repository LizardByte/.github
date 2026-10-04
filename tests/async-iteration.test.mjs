import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';

import {collectPages, forEachSequential} from '../.github/scripts/async-iteration.mjs';

test('forEachSequential waits for each operation before starting the next', async () => {
  const gate = Promise.withResolvers();
  const events = [];
  const completion = forEachSequential([1, 2], async (item) => {
    events.push(`start ${item}`);
    if (item === 1) {
      await gate.promise;
    }
    events.push(`end ${item}`);
  });

  await setImmediate();
  assert.deepEqual(events, ['start 1']);
  gate.resolve();
  await completion;
  assert.deepEqual(events, ['start 1', 'end 1', 'start 2', 'end 2']);
});

test('forEachSequential stops and closes a lazy iterable on failure', async () => {
  const events = [];
  function* items() {
    try {
      events.push('first');
      yield 1;
      events.push('second');
      yield 2;
    } finally {
      events.push('closed');
    }
  }
  const failure = new Error('operation failed');
  await assert.rejects(forEachSequential(items(), async () => {
    throw failure;
  }), failure);
  assert.deepEqual(events, ['first', 'closed']);
});

test('forEachSequential consumes asynchronous iterables', async () => {
  async function* items() {
    yield 1;
    yield 2;
  }
  const processed = [];
  await forEachSequential(items(), async (item) => {
    processed.push(item);
  });
  assert.deepEqual(processed, [1, 2]);
});

test('collectPages follows response cursors and preserves item order', async () => {
  const gate = Promise.withResolvers();
  const requested = [];
  const completion = collectPages('first', async (cursor) => {
    requested.push(cursor);
    if (cursor === 'first') {
      await gate.promise;
      return {items: [1, 2], nextCursor: 'last'};
    }
    return {items: [3], nextCursor: null};
  });

  await setImmediate();
  assert.deepEqual(requested, ['first']);
  gate.resolve();
  assert.deepEqual(await completion, [1, 2, 3]);
  assert.deepEqual(requested, ['first', 'last']);
});

test('collectPages accepts a zero cursor and ends at an undefined cursor', async () => {
  assert.deepEqual(await collectPages(0, async (cursor) => {
    assert.equal(cursor, 0);
    return {items: ['only page']};
  }), ['only page']);
});

test('collectPages propagates loader errors without requesting another page', async () => {
  const cursors = [];
  const failure = new Error('page failed');
  await assert.rejects(collectPages(1, async (cursor) => {
    cursors.push(cursor);
    if (cursor === 2) {
      throw failure;
    }
    return {items: [cursor], nextCursor: cursor + 1};
  }), failure);
  assert.deepEqual(cursors, [1, 2]);
});
