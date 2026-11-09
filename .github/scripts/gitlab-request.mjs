import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const apiOrigin = 'https://gitlab.com';
const apiPrefix = '/api/v4/';
const attempts = 5;
const maximumDelay = 300000;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Bound diagnostics and remove credentials before writing untrusted API messages to logs. */
function safeDetail(value, credentials) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const credential of credentials.filter(Boolean)) {
    for (const representation of [credential, encodeURIComponent(credential)]) {
      text = text.replaceAll(representation, '[REDACTED]');
    }
  }
  return text.replaceAll(/https?:\/\/[^\s"'<>]+/g, '[URL]').replaceAll(/\s/g, ' ').slice(0, 400);
}

/** Honor Retry-After seconds or dates, with exponential fallback when GitLab omits the header. */
function retryDelay(header, attempt, now) {
  const backoff = 15000 * 2 ** attempt;
  if (!header) return backoff;
  const serverDelay = /^\d+(?:\.\d+)?$/.test(header)
    ? Math.ceil(Number(header) * 1000) : Date.parse(header) - now();
  return Number.isFinite(serverDelay) ? Math.max(backoff, serverDelay) : backoff;
}

/** Preserve non-JSON error responses while rejecting malformed successful API results. */
function parseResponse(text, status) {
  try { return JSON.parse(text); }
  catch {
    if (status >= 200 && status < 300) throw new Error(`GitLab returned a non-JSON response (HTTP ${status})`);
    return {message: text || 'Empty response'};
  }
}

/** Share rate-limit handling between namespace preparation and the shell mirror's API calls. */
export async function requestGitLab(method, path, {
  token, githubToken, body, fetchImpl = fetch, sleep = pause, now = Date.now, log = console.error,
}, attempt = 0) {
  const url = new URL(path, `${apiOrigin}/api/v4/`);
  if (!['GET', 'POST', 'PUT'].includes(method) || url.origin !== apiOrigin ||
    url.username || url.password || !url.pathname.startsWith(apiPrefix)) {
    throw new Error('Invalid GitLab API request target');
  }
  const response = await fetchImpl(url.href, {
    method, redirect: 'manual', signal: AbortSignal.timeout(60000),
    headers: {'PRIVATE-TOKEN': token, Accept: 'application/json', 'Content-Type': 'application/json'},
    ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}),
  });
  const text = await response.text();
  if (response.status === 429 && attempt < attempts - 1) {
    const delay = retryDelay(response.headers.get('retry-after'), attempt, now);
    if (delay <= maximumDelay) {
      log(`GitLab rate limited the request (HTTP 429); retrying in ${delay / 1000}s (${attempt + 2}/${attempts}).`);
      await sleep(delay);
      return requestGitLab(method, path, {token, githubToken, body, fetchImpl, sleep, now, log}, attempt + 1);
    }
    log('GitLab Retry-After exceeds the five-minute automatic wait limit; the request will not be retried.');
  }
  const data = parseResponse(text, response.status);
  const credentials = [token, githubToken];
  const requestId = response.headers.get('x-request-id');
  const detail = safeDetail(data?.message ?? data?.error ?? 'No error details provided', credentials);
  const diagnostic = `${method} ${url.pathname} returned HTTP ${response.status}` +
    (requestId ? ` (request ID ${safeDetail(requestId, credentials)})` : '') + `: ${detail}`;
  if (response.status >= 400 && !(method === 'GET' && response.status === 404)) log(diagnostic);
  return {status: response.status, data, text, diagnostic};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('GitLab request helper does not accept CLI arguments');
  const payload = readFileSync(0, 'utf8').trim();
  const result = await requestGitLab(process.env.GITLAB_REQUEST_METHOD, process.env.GITLAB_REQUEST_URL, {
    token: process.env.GITLAB_TOKEN, githubToken: process.env.GITHUB_TOKEN, body: payload || undefined,
  });
  process.stdout.write(JSON.stringify({status: result.status, body: result.text}));
}
