# Organization administration

The Global replicator invokes `org_sync` once for both administration and files. Its
[single policy](org-sync.json) contains `files`, `properties`, and `administration` sections. LizardByte is the
administration source; all other orgs come directly from [organizations.json](../organizations.json), with no
second target list. Pull requests preview every operation;
master pushes, the daily schedule, and manual organization/full runs deliver them. Exact-repository runs
replicate files only. Administrative failure prevents file delivery in that invocation.
Dependabot-triggered runs retain file synchronization but omit administration: GitHub withholds normal Actions
secrets from those runs, and the organization-admin credential is not granted to Dependabot.

## Managed configuration

| Resource                | Policy                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| Custom-property schemas | Reconcile definitions across the registry; preserve repository values        |
| Shared org settings     | Copy supported shared fields; retain company, name, description, and website |
| Actions settings        | Copy permissions, workflow defaults, and retention                           |
| Blocked users           | Add source blocked users; retain destination-only blocks                     |
| Security configurations | Copy public and private/internal configurations and new-repository defaults  |
| Actions variables       | Copy names required by active projects to their destination orgs             |
| Actions secrets         | Supply values required by active projects to their destination orgs          |
| Dependabot secrets      | Supply values required by active pull-request workflows                      |
| Organization webhooks   | Copy source Discord hooks by URL prefix; exclude CLA Assistant               |

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

All synced secrets and variables belong to the destination **organization**. Repository-level copies are not
created. Each entry names its destination orgs; adding an org to the shared registry does not automatically
distribute credentials to it.
Credentials with the same source and settings share one entry listing all their destination organizations.

The policy omits access fields. New credentials are created with access to **all repositories** in their
destination org. Later value updates preserve the existing visibility and selected-repository list. You can
restrict access manually in the destination organization settings, and subsequent runs retain your choices.
Credentials can be provisioned before project repositories transfer.

The [test fixture](../tests/fixtures/org-sync-consumers.json) lists expected variable and secret names by
destination organization. Tests compare these organization-level expectations against the policy.
LizardByte-infrastructure has no credential entries. Repository exclusions from file sync do not restrict
access to organization credentials.

Configure each destination org's `CODECOV_TOKEN` manually in its Actions and Dependabot secrets as required by
its workflows. Codecov tokens are outside the sync policy and have no controller bindings.

Shared variables are copied by name from LizardByte. `READTHEDOCS_SLUG` remains a project-specific repository
override. Shared secret values come from explicit workflow secret bindings; GitHub cannot export stored secret
plaintext. Source-only social, AUR, CLA, GitLab rotation, branding, and monitoring credentials are excluded.
Dependabot entries contain only names required by the active pull-request workflows.

Every delivery resends configured secret values to support rotation. Variables are updated only when their
value changes. Missing supplied values fail delivery rather than clearing a secret. Omitting a credential
from the policy does not delete it from a destination.

`ORG_SYNC_ADMIN_TOKEN` supplies the administration credential when configured; otherwise the workflow uses
`GH_BOT_TOKEN`. It must administer the destinations and read the source. Classic tokens need `admin:org`;
webhook management also needs `admin:org_hook`. File delivery needs repository, workflow, and pull-request
write access. GitHub App tokens need the API-specific organization permissions listed in the
[action guide](https://github.com/LizardByte/actions/blob/c18db340531d8d60a9083435cd65c4dd62e60956/actions/org_sync/administration.md).
`ORG_SYNC_ADMIN_TOKEN` is controller-only and is not replicated.

## Discord webhooks

The action selects `web` hooks under `https://discord.com/api/webhooks/` from the source org at runtime, then
copies each hook's receiver URL, event subscriptions, activity, and content type to the destinations. This
follows matching source hooks automatically.
CLA Assistant is outside this prefix and is not copied. The Discord URL tokens are never committed or written
to the report. Discord receiver authentication is in the URL; `unsigned: true` explicitly configures delivery
without a separate GitHub HMAC signing secret.

Webhook discovery and replication both happen inside `org_sync`. The source credential must be able to read
those existing hooks. GitHub's OAuth webhook restrictions can produce a filtered empty response despite the
`admin:org_hook` scope; use a suitable PAT/App credential. An empty selected group fails rather than silently
skipping webhook synchronization. PRs only preview the copies; no webhook is created or updated until delivery.

## Transfer prerequisites

- Ensure the controller can read every source secret referenced by the workflow, including project API keys
  and Crowdin. Preserve existing source access when granting the controller access.
- Configure destination Codecov credentials manually and choose repository access in each org as needed.
- Ensure the administration credential has the required permissions across the registered orgs.
- Update project/shared workflow owner guards and publishing locations before transfer, including Crowdin
  and shared Node CI for `awesome-sunshine`; retain its `node_ci` profile.
- Review additional webhook receivers and supply signing secrets when required.
- Set organization default labels/default branch names, extra social links, package policies, standalone-org
  2FA, and PAT policies manually where supported write APIs are unavailable.

Review the combined report's organization before/after settings, schema defaults, credential access counts,
and per-operation status before merging. Delivery is not transactional: a failed later write can leave earlier
operations applied. Correct the reported cause and rerun; the action does not roll back newer organization state.
