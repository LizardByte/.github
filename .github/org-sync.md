# Organization administration

The Global replicator invokes `org_sync` once for both administration and files. Its
[policy](org-sync.json) uses LizardByte as the source and explicitly authorizes the other four organizations
in [organizations.json](../organizations.json) as destinations. Pull requests preview every operation;
master pushes, the daily schedule, and manual organization/full runs deliver them. Exact-repository runs
replicate files only. Administrative failure prevents file delivery in that invocation.

## Managed configuration

| Resource                 | Policy                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| Custom-property schemas  | Reconcile `repository-properties.json` across all five orgs; preserve repository values    |
| Shared org settings      | Copy 16 shared fields; retain each org's name, description, and website                    |
| Actions settings         | Copy permissions, workflow defaults, and retention                                         |
| Blocked users            | Add LizardByte's blocked users; retain destination-only blocks                             |
| Security configurations  | Copy `strict` and `private/internal repositories`, including their new-repository defaults |
| Actions variables        | Copy 14 org-wide variables and four selected variables                                     |
| Actions secrets          | Supply 31 org-wide secrets and five selected secrets available to this controller          |
| Dependabot secrets       | Supply ten org-wide secrets from the canonical Actions/variable bindings below             |
| Organization webhooks    | Copy LizardByte's Discord hooks by URL prefix; exclude CLA Assistant                       |

Each project org retains its current name, description, and website. Other shared profile fields, supported
member privileges, default repository permissions, project/Pages creation controls, private forking, signoff,
and deploy-key policy follow LizardByte. A null profile string is treated as empty, matching GitHub's readback.
The source currently allows all Actions, so its inactive selected-actions allowlist is not requested.
If LizardByte switches to selected actions or repositories, update the policy with the corresponding allowlist.

The two security defaults cover public and private/internal repositories separately. Configuration IDs are
resolved in each destination. Existing repositories are not attached or scanned by this policy. Public/private
feature availability and enterprise licensing still apply.

## Credentials and access

Values are supplied through explicit workflow environment bindings. The API cannot export existing secret
plaintext. Org-wide Actions secrets retain `all` visibility. Selected secrets and variables retain `selected`
visibility and are restricted to `.github` in LizardByte-infrastructure and SunshineStream. Their source grants
access to LizardByte/.github; source-only repository names are not copied as destination IDs or added to the
access lists. KokoStreamTV and Themerr do not yet have a `.github` repository, so those selected entries do not
target them. Once those repos exist, add their orgs to the selected entries' destination lists.

Actions is the canonical supplied value for the eight same-name org-wide Dependabot secrets. The remaining
two Dependabot entries, `GH_BOT_NAME` and `REDDIT_USERNAME`, deliberately use the same-name Actions variables.
This standardizes shared credentials; it does not read or verify the source Dependabot secret plaintext.
Every delivery resends configured secret values because GitHub cannot compare them. Variable writes occur
only when values or access differ. Missing supplied values fail delivery rather than clearing a secret.

`ORG_SYNC_ADMIN_TOKEN` can provide a separate administration credential; otherwise the action uses
`GH_PAT`, falling back to `GH_BOT_TOKEN`. The credential must administer every destination and read the source. Classic tokens need
`admin:org`; webhook management additionally needs `admin:org_hook`. File delivery still needs repository,
workflow, and pull-request write access. GitHub App tokens need the API-specific organization permissions
listed in the [action guide](https://github.com/LizardByte/actions/blob/codex/org-sync-property-schemas/actions/org_sync/administration.md).
Being an ordinary organization member is insufficient for many administrative operations.

The explicit destination lists prevent registry additions from distributing credentials automatically.
Schema provisioning still follows the registry. The dedicated `ORG_SYNC_ADMIN_TOKEN` is not in the replication
policy; `GH_PAT` and `GH_BOT_TOKEN` are explicitly shared entries. No secret values or variable values are committed.

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

- The other 22 selected Actions secrets are not available to LizardByte/.github. Supplying them to the
  controller and adding reviewed destination repository mappings is required before they can be synchronized.
  They include signing, Crowdin, Codecov API, Discord test, Patreon, Plex, TMDB, Twitch, and YouTube credentials.
- The 18 selected Dependabot secrets need explicit value bindings and repository mappings. Matching secret
  names alone do not make their plaintext accessible. Repository mappings can be added after the target repos exist.
- Codespaces organization-secret discovery returned HTTP 404, so no Codespaces secrets are assumed or configured.
- Additional receivers outside the Discord prefix need reviewed `webhooks` entries and, when applicable,
  supplied signing-secret bindings. No separate manual webhook replication runs alongside the action.
- Organization default labels/default branch names, extra social links, package policies, standalone-org 2FA,
  and PAT allow/approval/lifetime policies require manual setup because their public write APIs are unavailable.

Review the combined report's organization before/after settings, schema defaults, credential access counts,
and per-operation status before merging. Delivery is not transactional: a failed later write can leave earlier
operations applied. Correct the reported cause and rerun; the action does not roll back newer organization state.
