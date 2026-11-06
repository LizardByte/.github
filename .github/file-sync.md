# File synchronization

The **Global replicator** workflow uses `LizardByte/actions/actions/org_sync` to reconcile shared files across
the organizations in [organizations.json](../organizations.json). It replaces the old topic-based replicator
and the separate preview workflow. A single checkout supplies the policy and source files.

| Event                    | Mode     | Scope                                      |
| ------------------------ | -------- | ------------------------------------------ |
| Internal pull request    | Dry run  | All configured targets                     |
| Push to master           | Delivery | All configured targets                     |
| Daily at 11:17 UTC       | Delivery | All configured targets                     |
| Manual workflow dispatch | Delivery | All targets or the selected org/repository |

Every pull request and master push runs the workflow regardless of which files changed. Fork pull requests
skip the credentialed job. PR runs never create target Git objects, branches, or pull requests. Delivery runs
create or update one sync PR per repository; they do not merge those PRs. Delivery runs share a concurrency
group and are not canceled by subsequent runs. A newer PR preview can cancel an older preview of the same PR.

After merging this workflow, use **Run workflow** to optionally select an `organization` or exact
`owner/repository`. Empty inputs reconcile all configured targets. The former `repo_name` input is replaced
by the qualified `repository` input. The dedicated bot branch is `bot/org-sync-files`; the action does not
take over branches or PRs created by the old replicator.

## Policy and selection

- [organizations.json](../organizations.json) is the shared array of five organization names.
- [file-sync.json](file-sync.json) covers the existing file groups and 33 cleanup paths. General files, including
  Renovate, use `sync`. `create_if_missing` is available for reviewed exceptions.
- [repository-properties.json](../repository-properties.json) records the definitions provisioned in each org.
  `sync_mode: excluded` skips a repository. Multi-select `workflow_profiles` selects additional file groups.
- Public, unarchived repositories are eligible by default, including forks. The source repository is skipped.
  Existing mirror and Upptime exclusions in LizardByte-infrastructure apply through their properties.
- Deselected profiles remove their configured files on the next run. General files remain, and another selected
  rule can retain a shared path. Missing sources fail validation; deletion requires a profile/policy change or
  explicit cleanup rule. `_docker.yml` is cleanup-only because its source no longer exists.
- PR templates target only the existing `LizardByte/.github`, `LizardByte-infrastructure/.github`, and
  `SunshineStream/.github` repositories. Add `Themerr/.github` and `KokoStreamTV/.github` after creating them.
- The `docker` and `cpm` profile choices currently have no file mappings. CPM maintenance is a separate workflow.

## Reviewing a run

The run summary states whether delivery or dry-run mode was used and lists each repository's status and file
change count. Download `file-sync-<run-id>-<attempt>` and inspect `results.json` for exact paths, operations,
warnings, errors, and target PR URLs. Partial results are saved even when another target fails; a failed sync
still fails the job. Private/archived repositories, the skipped source repository, and empty organizations
produce no result rows.

The existing `GH_BOT_TOKEN` must read repository metadata/contents and organization custom properties across
the listed orgs. Delivery additionally requires permission to write contents/workflows and manage target PRs.
The token's user must have access in each organization. Missing access is reported per organization or repository.
The workflow's own `GITHUB_TOKEN` has only `contents: read`. Credentials, properties, secrets, and settings are
provisioned separately from file synchronization.
