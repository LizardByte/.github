# Organization and file synchronization

The **Global replicator** workflow uses `LizardByte/actions/actions/org_sync` to reconcile organization configuration
and shared files across the organizations in [organizations.json](../organizations.json). It replaces the old topic-based replicator
and the separate preview workflow. A single checkout supplies the policy and source files.

| Event                    | Mode     | Scope                                         |
| ------------------------ | -------- | --------------------------------------------- |
| Internal pull request    | Dry run  | All configured organizations and repositories |
| Push to master           | Delivery | All configured organizations and repositories |
| Daily at midnight UTC    | Delivery | All configured organizations and repositories |
| Manual workflow dispatch | Delivery | All targets or the selected org/repository    |

Every pull request and master push runs the workflow regardless of which files changed. Fork pull requests
skip the credentialed job. PR runs do not write organization or target repository state. Delivery runs apply
organization configuration directly, then create or update one sync PR per repository; they do not merge those PRs.
Delivery runs share a concurrency
group and are not canceled by subsequent runs. A newer PR preview can cancel an older preview of the same PR.

After merging this workflow, use **Run workflow** to optionally select an `organization` or exact
`owner/repository`. Empty inputs reconcile all configured targets. The former `repo_name` input is replaced
by the qualified `repository` input. The dedicated bot branch is `bot/org-sync-files`; the action does not
take over branches or PRs created by the old replicator.

One job and one action invocation handle both administration and file delivery. An exact `repository` dispatch
is file-only: it omits `properties_file` and `admin_config`, so it cannot change the whole organization while
targeting one repository. Use an `organization` dispatch or an unfiltered run to include administration.
Dependabot PRs still preview files, but omit the administration inputs because GitHub does not provide the
normal Actions admin secret to Dependabot runs. The owner credential is not replicated into Dependabot.

## Policy and selection

- [organizations.json](../organizations.json) is the shared array of five organization names.
- [file-sync.json](file-sync.json) covers the existing file groups and 33 cleanup paths. General files, including
  Renovate, use `sync`. `create_if_missing` is available for reviewed exceptions.
- [repository-properties.json](../repository-properties.json) records the definitions provisioned in each org.
  `sync_mode: excluded` skips a repository. Multi-select `workflow_profiles` selects additional file groups.
  The action now reads this file and reconciles definitions in every selected org before file delivery.
  Repository assignments and unrelated definitions are preserved. Changes to defaults can affect repositories
  inheriting them; the PR preview shows those changes before delivery.
- [org-sync.json](org-sync.json) selects shared settings, variables, supplied secrets, blocked users, and security
  configurations from LizardByte. See [organization administration](org-sync.md) for the scope and remaining setup.
- Public, unarchived repositories are eligible by default, including forks. The source repository is skipped.
  Existing mirror and Upptime exclusions in LizardByte-infrastructure apply through their properties.
- Deselected profiles remove their configured files on the next run. General files remain, and another selected
  rule can retain a shared path. Missing sources fail validation; deletion requires a profile/policy change or
  explicit cleanup rule. `_docker.yml` is cleanup-only because its source no longer exists.
- Community health defaults use `repository_names: [".github"]` across `organizations.json`: `FUNDING.yml`,
  `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, the issue forms/configuration, and the PR template.
  These always sync in eligible `.github` repositories, replacing existing versions without requiring a profile.
  The `custom_issues` profile still controls issue configuration in ordinary repositories; deselecting it does not
  remove an organization's default configuration. Adding an org or creating its `.github` repo needs no policy edit.
  Organizations without a `.github` repo are skipped for this rule. Normal eligibility and custom-property checks
  still apply, including the source-repository exclusion.
  GitHub [inherits these defaults](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
  in repositories without their own matching files; repository-specific issue templates/configuration override
  the whole default issue-template directory. Other supported defaults such as `ACCESSIBILITY.md`, discussion
  forms, and vulnerability-report forms can be added to this rule when source files exist.
- The `docker` and `cpm` profile choices currently have no file mappings. CPM maintenance is a separate workflow.

## Reviewing a run

The reusable action writes the run summary and uploads a JSON report artifact with a unique `file-sync-` name.
No local report script or upload step is needed. The summary states whether delivery or dry-run mode was used
and lists each repository's status and file change count. Inspect the artifact's `results.json` for exact paths,
operations, warnings, errors, and target PR URLs. Partial results are saved even when another target fails; a
failed sync still fails the job. Private/archived repositories, the skipped source repository, and empty
organizations produce no result rows.

The existing `GH_BOT_TOKEN` must read repository metadata/contents and organization custom properties across
the listed orgs. Delivery additionally requires permission to write contents/workflows and manage target PRs.
The token's user must have access in each organization. Missing access is reported per organization or repository.
The workflow's own `GITHUB_TOKEN` has only `contents: read`. Administration uses `ORG_SYNC_ADMIN_TOKEN` when
provided, otherwise `GH_BOT_TOKEN`; that credential needs the organization API permissions described in the
administration guide. Secrets are supplied through explicit environment bindings, never through committed values.
