const DEFAULT_MAX_RUNTIME_MS = 5.5 * 60 * 60 * 1000;

/** A cleanup budget was reached; unfinished work can wait until the next run. */
export class CleanupStopped extends Error {}

/**
 * Stop cleanup after 5.5 hours, leaving 30 minutes for the job summary and shutdown.
 * Bound pending requests as well as the time between sequential operations.
 *
 * @param {object} [options] Time budget and clock dependencies.
 * @returns {object} Deadline checks and bounded HTTP/GitHub clients.
 */
export function createCleanupRuntime({maxRuntimeMs = DEFAULT_MAX_RUNTIME_MS, now = () => performance.now()} = {}) {
  const deadline = now() + maxRuntimeMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxRuntimeMs);
  timer.unref();
  const stopped = () => new CleanupStopped('Cleanup time budget reached; remaining cleanup is deferred.');
  const check = () => {
    if (now() >= deadline) {
      controller.abort();
    }
    if (controller.signal.aborted) {
      throw stopped();
    }
  };
  const run = async (operation) => {
    check();
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(stopped());
      controller.signal.addEventListener('abort', onAbort, {once: true});
    });
    try {
      // Do not check after success: a confirmed deletion must still be counted at the deadline.
      return await Promise.race([operation(), aborted]);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
    }
  };
  const requestOptions = (options = {}) => ({
    ...options,
    request: {...options.request, signal: controller.signal},
  });
  return {
    check,
    run,
    dispose() {
      clearTimeout(timer);
      controller.abort();
    },
    fetch: (url, options = {}) => run(() => fetch(url, {
      ...options,
      signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
    })),
    github: (github) => ({
      rest: github.rest,
      request: (route, options) => run(() => github.request(route, requestOptions(options))),
      paginate: (route, options, mapPage) => run(() => github.paginate(route, requestOptions(options), (page, done) => {
        check();
        return mapPage ? mapPage(page, done) : page.data;
      })),
    }),
  };
}
