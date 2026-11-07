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

Repositories excluded from the GitLab mirror are listed in `.github/repositories-to-ignore.json`.

The GitLab mirror also excludes GitHub temporary security advisory forks matching
`<repository>-ghsa-xxxx-xxxx-xxxx`.
