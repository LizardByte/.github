# Organization administration

The Global replicator invokes `org_sync` once for both administration and files. Its
[policy](org-sync.json) uses LizardByte as the source and explicitly authorizes the other four organizations
in [organizations.json](../organizations.json) as destinations. Pull requests preview every operation;
master pushes, the daily schedule, and manual organization/full runs deliver them. Exact-repository runs
replicate files only. Administrative failure prevents file delivery in that invocation.
Dependabot-triggered runs retain file synchronization but omit administration: GitHub withholds normal Actions
secrets from those runs, and the organization-admin credential is not granted to Dependabot.

## Managed configuration

| Resource                 | Policy                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Custom-property schemas  | Reconcile `repository-properties.json` across all five orgs; preserve repository values    |
| Shared org settings      | Copy 15 shared fields; retain each org's company, name, description, and website           |
| Actions settings         | Copy permissions, workflow defaults, and retention                                         |
| Blocked users            | Add LizardByte's blocked users; retain destination-only blocks                             |
| Security configurations  | Copy `strict` and `private/internal repositories`, including their new-repository defaults |
| Actions variables        | Copy five shared variable names only to their audited consumers                            |
| Actions secrets          | Supply 25 shared secret names plus destination-specific Codecov tokens                     |
| Dependabot secrets       | Supply only the audited pull-request consumers below                                       |
| Organization webhooks    | Copy LizardByte's Discord hooks by URL prefix; exclude CLA Assistant                       |

Each project org retains its current company, name, description, and website. `company` is a separate profile
field; the organization display name uses `name`. Other shared profile fields, supported
member privileges, default repository permissions, project/Pages creation controls, private forking, signoff,
and deploy-key policy follow LizardByte. A null profile string is treated as empty, matching GitHub's readback.
The source currently allows all Actions, so its inactive selected-actions allowlist is not requested.
If LizardByte switches to selected actions or repositories, update the policy with the corresponding allowlist.

The two security defaults cover public and private/internal repositories separately. Configuration IDs are
resolved in each destination. Existing repositories are not attached or scanned by this policy. Public/private
feature availability and enterprise licensing still apply.

## Credentials and access

The allowlists come from the four active moving repositories and the shared workflows they call, including
Docker, Homebrew, documentation, Pages, Copr, localization, and screenshot publishing. The
[audit fixture](../tests/fixtures/org-sync-consumers.json) records source commits and exact credential names.
Tests reject missing or extra recipients against that audit. Archived Themerr-jellyfin and Themerr-kodi do
not receive credentials. Neither LizardByte-infrastructure nor destination `.github` repositories are recipients.

| Consumer                 | Variables | Actions secrets | Dependabot secrets |
| ------------------------ | --------- | --------------- | ------------------ |
| SunshineStream/Sunshine  | 5         | 20              | 3                  |
| Themerr/Themerr          | 5         | 13              | 1                  |
| Themerr/ThemerrDB        | 1         | 7               | 7                  |
| KokoStreamTV/Koko        | 3         | 15              | 1                  |

All entries use `selected` visibility and explicit destination organization/repository names. Same-name
entries may have different scopes or values for disjoint orgs. No credentials are granted org-wide or to the
temporary Pages test repository. `missing_repositories: defer` postpones an entry when none of its named
recipients exist; later runs grant only the named repositories that have arrived. Remaining recipients produce
warnings until transferred. Existing credentials are untouched while an entire entry is deferred.

The five shared variables are `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_CERT_PROFILE`, `AZURE_SIGNING_ENDPOINT`,
`DOCKER_HUB_USERNAME`, and `GH_BOT_NAME`. Each targets only its consumers. `READTHEDOCS_SLUG` is a project-specific
repository override and is not synchronized from the main org. Source-only social, AUR, CLA, GitLab rotation,
logo/color, and monitoring credentials are excluded from the policy and supplied environment.

Dependabot receives the same Codecov credential as Actions for each active repo. Sunshine additionally needs
the bot token/email for required Homebrew and Pages workflow inputs. ThemerrDB needs its bot token/email for
Pages plus the four API keys used by its database Pages workflow. Release-only signing/publishing credentials
are not copied into Dependabot. Shared secret values come from explicit Actions secret bindings, never API
plaintext exports or speculative copies of every source-org secret.

Codecov upload tokens have repository/organization scope. The source org's `CODECOV_TOKEN` is not copied.
Each destination's own token is supplied through a dedicated controller binding and written as `CODECOV_TOKEN`
only for that org's audited recipients, in both the Actions and Dependabot namespaces:

| Destination org | Controller secret binding              |
| --------------- | -------------------------------------- |
| KokoStreamTV    | `ORG_SYNC_CODECOV_KOKOSTREAMTV`        |
| SunshineStream  | `ORG_SYNC_CODECOV_SUNSHINESTREAM`      |
| Themerr         | `ORG_SYNC_CODECOV_THEMERR`             |

See [Codecov's token scopes](https://docs.codecov.com/docs/codecov-tokens). Configure these controller secrets
with tokens from the corresponding Codecov orgs, rather than reusing LizardByte's global token.

Every delivery resends configured secret values because GitHub cannot compare them. Variable writes occur
only when values or access differ. Missing supplied values fail delivery rather than clearing a secret.

`ORG_SYNC_ADMIN_TOKEN` can provide a separate administration credential; otherwise the action uses
`GH_BOT_TOKEN`. The previous `GH_PAT` fallback returned HTTP 401 and is no longer used. The credential must
administer every destination and read the source. Classic tokens need
`admin:org`; webhook management additionally needs `admin:org_hook`. File delivery still needs repository,
workflow, and pull-request write access. GitHub App tokens need the API-specific organization permissions
listed in the [action guide](https://github.com/LizardByte/actions/blob/d4c3996b16bc81b160b02c22958150d1724b6f89/actions/org_sync/administration.md).
Being an ordinary organization member is insufficient for many administrative operations.

The explicit destination lists prevent registry additions from distributing credentials automatically.
Schema provisioning still follows the registry. Neither `ORG_SYNC_ADMIN_TOKEN` nor `GH_PAT` is replicated.
`GH_BOT_TOKEN` is supplied only to its audited consumers. No secret values or variable values are committed.

## Discord webhooks

The action selects `web` hooks under `https://discord.com/api/webhooks/` from the source org at runtime, then
copies each hook's receiver URL, event subscriptions, activity, and content type to the destinations. This
includes the six Discord hooks shown in the source settings and follows future matching hooks automatically.
CLA Assistant is outside this prefix and is not copied. The Discord URL tokens are never committed or written
to the report. Discord receiver authentication is in the URL; `unsigned: true` explicitly configures delivery
without a separate GitHub HMAC signing secret.

Webhook discovery and replication both happen inside `org_sync`. The source credential must be able to read
those existing hooks. GitHub's OAuth webhook restrictions can produce a filtered empty response despite the
`admin:org_hook` scope; use a suitable PAT/App credential. An empty selected group fails rather than silently
skipping webhook synchronization. PRs only preview the copies; no webhook is created or updated until delivery.

## Remaining bootstrap work

- The controller must retain access to six source Actions secrets: `FANART_PROJECT_API_KEY` and
  `LRCLIB_APPLICATION_ID` for Koko, plus `TMDB_API_KEY_V3`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and
  `YOUTUBE_API_KEY` for ThemerrDB. Controller access was provisioned with approval by adding only LizardByte/.github
  to those selected-repository lists and verifying that previous recipients remained. No Plex, Patreon, Crowdin,
  social, or unrelated API credentials are needed by this audit.
- Supply the three destination-specific Codecov bindings above before their recipients transfer. Once a
  recipient exists, missing supplied credentials fail delivery rather than silently creating an unusable setup.
- Supply `ORG_SYNC_ADMIN_TOKEN` with organization-administration and webhook API access if the bot token lacks
  those permissions. The current bot token returned HTTP 403 when reading Actions settings, despite the bot's
  verified owner membership. A classic PAT from an owner of all five orgs needs `admin:org` and `admin:org_hook`.
- Some source workflows still hard-code the LizardByte owner or old publishing locations. Update those as part
  of transfer preparation; this policy covers their intended consumers after the owner guards are corrected.
- Codespaces organization-secret discovery returned HTTP 404, so no Codespaces secrets are assumed or configured.
- Additional receivers outside the Discord prefix need reviewed `webhooks` entries and, when applicable,
  supplied signing-secret bindings. No separate manual webhook replication runs alongside the action.
- Organization default labels/default branch names, extra social links, package policies, standalone-org 2FA,
  and PAT allow/approval/lifetime policies require manual setup because their public write APIs are unavailable.

Review the combined report's organization before/after settings, schema defaults, credential access counts,
and per-operation status before merging. Delivery is not transactional: a failed later write can leave earlier
operations applied. Correct the reported cause and rerun; the action does not roll back newer organization state.
