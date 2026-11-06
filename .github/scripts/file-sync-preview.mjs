import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

/**
 * Save read-only action results and publish their counts to the run summary.
 * Failed action steps can still provide partial results for the other organizations.
 *
 * @param {object} options Actions core/context, environment, and optional output directory.
 * @returns {Promise<object>} The report written to the artifact.
 */
export async function writePreviewReport({core, context, env, outputDirectory = 'build/file-sync-preview'}) {
  const results = JSON.parse(env.PREVIEW_RESULTS || '[]');
  if (!Array.isArray(results)) {
    throw new TypeError('Expected an array of file sync results');
  }
  const report = {
    dry_run: true,
    source_commit: context.sha,
    source_ref: context.ref,
    organization: env.PREVIEW_ORGANIZATION || null,
    repository: env.PREVIEW_REPOSITORY || null,
    outcome: env.PREVIEW_OUTCOME,
    changed_repositories: Number(env.PREVIEW_CHANGED || 0),
    failed_repositories: Number(env.PREVIEW_FAILED || 0),
    results,
  };
  await mkdir(outputDirectory, {recursive: true});
  await writeFile(path.join(outputDirectory, 'results.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  core.summary.addHeading('File sync preview');
  core.summary.addRaw('Dry run only. The current global replicator remains active.\n\n');
  core.summary.addRaw(`Preview step outcome: **${report.outcome}**. See the step logs for discovery failures.\n\n`);
  core.summary.addRaw(`Repositories with proposed changes: **${report.changed_repositories}**; `
    + `failed targets: **${report.failed_repositories}**.\n\n`);
  core.summary.addTable([
    [
      {data: 'Repository', header: true},
      {data: 'Status', header: true},
      {data: 'File changes', header: true},
    ],
    ...results.map(result => [result.repository, result.status, String(result.changes?.length ?? 0)]),
  ]);
  core.summary.addRaw('\nDownload the file-sync-preview artifact for exact paths, operations, warnings, and errors.\n');
  await core.summary.write();
  return report;
}
