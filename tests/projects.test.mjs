import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import vm from 'node:vm';
import test from 'node:test';

const script = readFileSync(new URL('../docs/source/_static/js/projects.js', import.meta.url), 'utf8');

function page({fetch, readyState = 'complete', failList = false, hasOverview = true}) {
  const errors = [];
  const elements = [];
  const listeners = new Map();
  function createElement(tag) {
    const element = {
      tag, children: [], style: {},
      appendChild(child) {
        if (failList && tag === 'ul') {
          throw new Error('List unavailable');
        }
        this.children.push(child);
      },
    };
    elements.push(element);
    return element;
  }
  const overview = createElement('div');
  vm.runInNewContext(script, {
    document: {
      readyState,
      createElement,
      getElementById: () => hasOverview ? overview : null,
      getElementsByClassName: () => [],
      addEventListener: (name, handler) => listeners.set(name, handler),
    },
    fetch,
    console: {error: (...args) => errors.push(args)},
  });
  return {errors, elements, listeners};
}

test('projects initialize after DOMContentLoaded and render active projects before archived ones', async () => {
  let requests = 0;
  const result = page({
    readyState: 'loading',
    fetch: async () => {
      requests += 1;
      return Response.json({
        archived: {child: {name: 'Alpha', tags: ['archived']}},
        active: {child: {name: 'Zulu', urls: {documentation: 'https://example.com/docs'}}},
      });
    },
  });
  assert.equal(requests, 0);
  result.listeners.get('DOMContentLoaded')();
  await setImmediate();
  assert.equal(requests, 1);
  const list = result.elements.find(({tag}) => tag === 'ul');
  assert.deepEqual(list.children.map((item) => item.children[0].textContent), ['Zulu', 'Alpha (Archived)']);
  assert.deepEqual(result.errors, []);
});

test('projects show their existing error message when fetching fails', async () => {
  const result = page({fetch: async () => { throw new Error('Offline'); }});
  await setImmediate();
  const list = result.elements.find(({tag}) => tag === 'ul');
  assert.equal(list.children[0].textContent, 'Failed to load projects. Please try again later.');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0][0], 'Error fetching projects:');
});

test('projects handle rejection when rendering the error message also fails', async () => {
  const result = page({fetch: async () => { throw new Error('Offline'); }, failList: true});
  await setImmediate();
  assert.deepEqual(result.errors.map(([message]) => message), [
    'Error fetching projects:', 'Error initializing projects:',
  ]);
  assert.equal(result.errors[1][1].message, 'List unavailable');
});

test('projects skip initialization on pages without an overview', () => {
  const result = page({fetch: () => assert.fail('Unexpected request'), hasOverview: false});
  assert.equal(result.elements.length, 1);
});
