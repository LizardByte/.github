# File sync preview

The **File sync preview** workflow plans shared-file changes without creating target Git objects, branches, or
pull requests. `dry_run` is fixed to `true`; there is no input that enables delivery. The current global replicator
stays active. Its obsolete Docker replication step has been removed because `_docker.yml` no longer exists.

The preview runs for relevant changes on internal pull requests and master, daily at 11:17 UTC, and manually.
Fork pull requests do not run the credentialed preview. After this workflow is merged, use **Run workflow** to
optionally narrow a run to an organization or an exact `owner/repository`. Empty inputs preview all configured targets.

## Policy and selection

- [organizations.json](../organizations.json) is the shared array of five organization names.
- [file-sync.json](file-sync.json) preserves the remaining legacy file groups and 33 cleanup paths. Existing general
  files, including Renovate, retain their `sync` behavior. `create_if_missing` remains available for reviewed exceptions.
- [repository-properties.json](../repository-properties.json) records the definitions already provisioned in each org.
  `sync_mode: excluded` skips a repository. Multi-select `workflow_profiles` selects additional file groups.
- Public, unarchived repositories are eligible by default, including forks. The source repository is skipped.
  Existing mirror and Upptime exclusions in LizardByte-infrastructure continue to apply through their properties.
- Deselected profiles propose removing their configured files. General files remain, and another selected rule
  can retain a shared path. Missing sources fail validation; deletion requires a profile/policy change or cleanup rule.
- PR templates target only the existing `LizardByte/.github`, `LizardByte-infrastructure/.github`, and
  `SunshineStream/.github` repositories. Add `Themerr/.github` and `KokoStreamTV/.github` after creating them.
- The `docker` and `cpm` profile choices currently have no file mappings: the old Docker wrapper is cleanup-only,
  and CPM maintenance is a separate central workflow.

## Reviewing a run

The run summary lists each repository's status and number of proposed file changes. Download its
`file-sync-preview-<run-id>-<attempt>` artifact and inspect `results.json` for each exact path and create/update/remove
operation. Partial results are saved even when another target fails; a failed preview still fails the job.
Private/archived repositories, the skipped source repository, and empty organizations produce no result rows.

The workflow uses the existing `GH_BOT_TOKEN`. It must be able to read repository metadata/contents and organization
custom properties across the listed orgs. Previewing requires no target write permission. Missing access is reported
per organization or repository; changing GitHub properties, credentials, or secrets is outside this workflow.

## Production cutover

Review the dry-run results first, then rehearse delivery, repeated runs, profile deselection, exact targets, and
existing-file preservation in disposable repositories. A separate reviewed change will disable the old writer and
enable the new writer. This PR does not perform that switch.
