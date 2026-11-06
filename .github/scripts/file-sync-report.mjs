import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

/**
 * Save preview or delivery results and publish their counts to the run summary.
 * Failed action steps can still provide partial results for the other organizations.
 *
 * @param {object} options Actions core/context, environment, and optional output directory.
 * @returns {Promise<object>} The report written to the artifact.
 */
export async function writeSyncReport({core, context, env, outputDirectory = 'build/file-sync'}) {
  if (!['true', 'false'].includes(env.SYNC_DRY_RUN)) {
    throw new TypeError('Expected an explicit file sync dry-run mode');
  }
  const results = JSON.parse(env.SYNC_RESULTS || '[]');
  if (!Array.isArray(results)) {
    throw new TypeError('Expected an array of file sync results');
  }
  const report = {
    dry_run: env.SYNC_DRY_RUN === 'true',
    source_commit: context.sha,
    source_ref: context.ref,
    organization: env.SYNC_ORGANIZATION || null,
    repository: env.SYNC_REPOSITORY || null,
    outcome: env.SYNC_OUTCOME,
    changed_repositories: Number(env.SYNC_CHANGED || 0),
    failed_repositories: Number(env.SYNC_FAILED || 0),
    results,
  };
  await mkdir(outputDirectory, {recursive: true});
  await writeFile(path.join(outputDirectory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  core.summary.addHeading(report.dry_run ? 'File sync preview' : 'File synchronization');
  core.summary.addRaw(report.dry_run
    ? 'Dry run only. No target Git objects, branches, or pull requests were written.\n\n'
    : 'Delivery enabled. Shared-file changes are proposed through target pull requests.\n\n');
  core.summary.addRaw(`Sync step outcome: **${report.outcome}**. See the step logs for failures.\n\n`);
  core.summary.addRaw(`Repositories changed or planned: **${report.changed_repositories}**; `
    + `failed targets: **${report.failed_repositories}**.\n\n`);
  core.summary.addTable([
    [
      {data: 'Repository', header: true},
      {data: 'Status', header: true},
      {data: 'File changes', header: true},
    ],
    ...results.map(result => [result.repository, result.status, String(result.changes?.length ?? 0)]),
  ]);
  core.summary.addRaw('\nDownload the file-sync artifact for exact paths, operations, warnings, errors, and PR URLs.\n');
  await core.summary.write();
  return report;
}
