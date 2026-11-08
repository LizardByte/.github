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

Repositories excluded from the GitLab mirror are listed in `.github/repositories-to-ignore.json`.

The GitLab mirror also excludes GitHub temporary security advisory forks matching
`<repository>-ghsa-xxxx-xxxx-xxxx`.
