# LizardByte org workflows

Files prefixed with `__` are only used in the `.github` repository and not replicated to other repositories;
however, some of them may be called from other workflows.

Workflows that can be called from other repositories are prefixed with `__call-` and are not replicated
to other repositories. They also have an accompanying workflow named `_<name>.yml` that is replicated to the
respective repositories.

Workflows that prefixed with a single `_` are replicated to other repositories and this indicates
that the workflow should not be modified when inside the other repositories.

The [global replicator](../file-sync.md) selects repositories through the `sync_mode` and `workflow_profiles`
custom properties. It previews every internal PR and delivers on master pushes, daily, or manually.

Release-notification and package-publishing workflows check the caller's `workflow_profiles` custom property
through the repository API. Their profiles are `release_notifications`, `flathub`, `homebrew`, `pacman`, and
`winget`. The CPM maintenance matrix selects `cpm` through the same property. Missing, null, or empty profile
selections disable that workflow group; invalid values or failed property reads fail the check. These runtime
checks are independent of the file replicator's `sync_mode` setting.

The `__call-organization.yml` reusable workflow exports an `allowed` output based on the caller's
owner and the trusted `LizardByte/.github/master/organizations.json` registry. It needs no custom secrets
or repository permissions and fails if the registry cannot be read or validated. New organizations only
need to be added to that registry. Consumer workflows use this check for publishing, coverage uploads,
and organization automation; ordinary test builds remain available to unregistered forks. The controller's
own maintenance jobs retain their repository restrictions.

Shared publishing destinations remain in LizardByte, including the website, Homebrew tap, pacman repository,
Docker/GHCR namespace, npm scope, and WinGet identifiers. Docker callers can override `image_namespace` if
they publish elsewhere. WinGet uses the configured bot's fork. Cross-organization GitHub npm publishing
requires `GH_TOKEN` with `write:packages` access to the existing LizardByte packages; the replicated wrapper
passes `GH_BOT_TOKEN`. npmjs trusted-publisher bindings and external service installations must also be
updated for the destination owner when transferring a repository.

Central stale-issue, license-year, CPM, and Pinact workflows read `organizations.json` as well.
Repository matrices use qualified identities so matching names in different orgs remain distinct. Public
maintenance matrices exclude private and archived repositories; license updates also exclude forks. CPM
continues to select the `cpm` custom-property profile. Manual stale/CPM dispatches preview their matrices.
The build-deps updater uses explicit `owner/repository` choices, which must be updated after a transfer;
dependency releases still come from `LizardByte/build-deps`. Pinact accepts qualified repo names
or unambiguous short names and preserves shared `master` references across all registered orgs.

The GitLab mirror reads all registered orgs, including private, archived, and forked source repositories.
Repositories excluded from it are listed as qualified `owner/repository` names in
`.github/repositories-to-ignore.json`.

The GitLab mirror also excludes GitHub temporary security advisory forks matching
`<repository>-ghsa-xxxx-xxxx-xxxx`.

GitHub repositories in LizardByte retain their existing GitLab paths under `lizardbyte`. Other GitHub orgs
use automatically created subgroups: for example, `SunshineStream/Sunshine` maps to
`lizardbyte/sunshinestream/Sunshine`. The existing parent group must exist. Subgroups inherit its visibility
and membership; the [API cannot create top-level groups on GitLab.com](https://docs.gitlab.com/api/groups/#create-a-group).

When a GitHub repository moves, the mirror verifies the existing root project's GitHub repository ID and
transfers that GitLab project into the matching subgroup. Legacy descriptions are checked through GitHub's
repository API, following transfer redirects. GitLab project IDs, Git history, issues, and settings are retained.
New mirror descriptions record the immutable GitHub ID. Identity mismatches at the destination, lookup failures,
and incomplete transfers stop that repository's delivery while other repositories continue. Private sources are
verified as private before any transfer or Git push. Existing archived GitLab mirrors require manual handling;
the workflow does not unarchive them. Large-project imports and the existing GitLab SSH transport remain in use.

Namespace preparation and mirror delivery share the same GitLab request helper. HTTP 429 responses are retried
up to five attempts, honoring `Retry-After` with exponential backoff when the header is absent. A requested wait
longer than five minutes is reported instead of retried early. Other HTTP errors, including 404s after project
creation, remain failures and include bounded, credential-redacted API details and the GitLab request ID when
available. No project is recreated to work around those errors.

`GITLAB_TOKEN` needs access to read/create subgroups under `lizardbyte`, create/update projects and their visibility,
transfer existing mirror projects, and use the existing import APIs. Transfers require project Owner access and
permission to create projects in the destination group. See [GitLab project transfers](https://docs.gitlab.com/user/project/working_with_projects/#transfer-a-project).
The SSH identity must retain Git push access inherited
from the parent group. These use the existing controller credentials; no destination-org secrets are needed.
