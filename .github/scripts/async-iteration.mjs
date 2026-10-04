/**
 * Process items one at a time, stopping immediately if an operation fails.
 * Use this for operations sharing a rate limit, deletion budget, or build state.
 *
 * @param {Iterable|AsyncIterable} items Items to process lazily.
 * @param {(item: any) => Promise<void>} operation Operation to complete before advancing.
 * @returns {Promise<void>} Completion of all operations.
 */
export async function forEachSequential(items, operation) {
  for await (const item of items) {
    await operation(item);
  }
}

/**
 * Collect pages whose next cursor is only known after loading the current page.
 *
 * @param {any} initialCursor Cursor for the first page.
 * @param {(cursor: any) => Promise<{items: Array, nextCursor: any}>} loadPage Page loader.
 * @returns {Promise<Array>} Items in page order. A nullish cursor ends pagination.
 */
export async function collectPages(initialCursor, loadPage) {
  let cursor = initialCursor;
  const pages = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (cursor === null || cursor === undefined) {
        return {done: true};
      }
      const page = await loadPage(cursor);
      cursor = page.nextCursor;
      return {done: false, value: page.items};
    },
  };
  const results = [];
  for await (const items of pages) {
    results.push(...items);
  }
  return results;
}
