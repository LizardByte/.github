# Onboard a LizardByte GitHub organization

Use this checklist to set up a project organization and connect it to LizardByte's shared automation.
Create the GitHub organization and its public `.github` repository before adding the organization to the registry.

## 1. Create the GitHub organization

1. From a maintainer account, create the organization and use the LizardByte billing email address from the team's
   records. Set the organization's display name, avatar, description, and website for the project.
   [GitHub organization setup](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/creating-a-new-organization-from-scratch)
2. Open the organization's **People** page and invite `LizardByte-bot` as a member.
3. Open the invitation email from the LizardByte mailbox in a private browser window. Sign in to GitHub as
   `LizardByte-bot` in that window and accept the invitation.
4. In the bot's session, open the organization's **People** page and change the bot's membership visibility to
   **Public**. [GitHub membership visibility](https://docs.github.com/en/account-and-profile/how-tos/organization-membership/publicizing-or-hiding-organization-membership)
5. Back in the maintainer's session, use **People** to change `LizardByte-bot` to **Owner**. Keep the maintainer's
   owner access. `LizardByte-bot` owns `ORG_SYNC_ADMIN_TOKEN` and administers the new organization for the replicator.

## 2. Install the GitHub Apps

### Codecov

1. Sign in through [Codecov](https://about.codecov.io/) and install the Codecov GitHub App in the new organization.
   Include the repositories that will publish coverage. [Codecov setup](https://docs.codecov.com/docs/quick-start)
2. Open [LizardByte's Global YAML](https://app.codecov.io/account/gh/LizardByte/yaml). Copy it to the new
   organization's **Settings → Global YAML** page. Repository YAML can override it.
   [Codecov YAML precedence](https://docs.codecov.com/docs/codecov-yaml)
3. For workflows that use `CODECOV_TOKEN`, configure the new organization's token in its GitHub Actions secrets.
   Add it to the organization's Dependabot secrets too if a Dependabot-triggered workflow needs it. Set
   repository access in each secret store. Org sync leaves Codecov credentials to the maintainer.

### Mend Renovate

1. Sign in to [Mend Developer Platform](https://developer.mend.io/), install the app in the new GitHub
   organization, and select **Renovate Only** in the setup wizard.
   [Mend installation guide](https://docs.mend.io/integrations/latest/install-mend-developer-platform-for-github)
2. In Mend, copy the dependency settings from LizardByte's installation and grant access to the repositories
   Renovate should update. Use the [shared Renovate configuration](../renovate/README.md) for repository policy.

## 3. Configure SonarQube Cloud

### Create and bind the organization

1. In [SonarQube Cloud](https://sonarcloud.io/), create an organization by importing the new GitHub organization.
   Install the SonarQube Cloud GitHub App with **All repositories** access.
2. On the organization creation screen, choose **Start SonarQube for OSS**. The OSS plan supports custom quality
   profiles and gates for public projects. [SonarQube Cloud plans](https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-subscription/subscription-plans)
3. Enable **Auto-import new GitHub repositories**. Check it under **Administration → Organization Settings →
   Organization binding**. Use **Analyze new project** to import current repositories that predate auto-import
   or transferred repositories that are missing from the project list.
   [GitHub organization binding](https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-organization/creating-organization/importing-github-organization)

### Set the quality profiles

1. In the destination organization, open **Policies → Quality Profiles → General → All**. Open the action menu
   for **Sonar way comprehensive**, select **Set as default**, and choose **Set for all languages**. This matches
   the built-in defaults in LizardByte. Apply this before setting the GitHub Actions override below.
   [Changing default profiles](https://docs.sonarsource.com/sonarqube-cloud/standards/managing-quality-profiles/changing-default-quality-profile)
2. In [LizardByte's GitHub Actions quality profiles](https://sonarcloud.io/organizations/lizardbyte/quality_profiles?language=githubactions&view=advanced),
   open the menu for the custom **LizardByte** profile and choose **Back up** to download its XML.
3. In the destination's **Quality Profiles → Language-specific** tab, choose **Restore** and upload the XML.
   Open the restored profile. Under **Inheritance → Change parent**, select **Sonar way comprehensive (Built-in)**
   for GitHub Actions. When restoring over an existing profile, Sonar adds missing active rules. Compare rule
   overrides and parameters with the source and update any differences.
   [Export and restore](https://docs.sonarsource.com/sonarqube-cloud/standards/managing-quality-profiles/creating-a-quality-profile)
4. In the **GitHub Actions** language section, set the restored **LizardByte** profile as the default, following
   SunshineStream, Themerr, and KokoStreamTV. Verify the **Default** marker for GitHub Actions and confirm that the
   other languages still use **Sonar way comprehensive**. An existing project's explicit assignment takes
   precedence over the organization default.

### Set the quality gate

1. Open the destination's **Quality Gates**, select **Sonar way**, and choose **Actions → Copy**. Name the copy
   **LizardByte**. Compare it with the [source quality gate](https://sonarcloud.io/organizations/lizardbyte/quality_gates).
2. Edit the copied conditions to match the table. All eight conditions apply to **New Code**. Remove any extra
   conditions and set **LizardByte** as the default gate.
   [Managing custom gates](https://docs.sonarsource.com/sonarqube-cloud/standards/managing-quality-gates/managing-custom-quality-gates)

| Metric                     | Fails when      | Value |
| -------------------------- | --------------- | ----- |
| Coverage                   | Is less than    | 80%   |
| Duplicated blocks          | Is greater than | 0     |
| Duplicated Lines (%)       | Is greater than | 2%    |
| Maintainability Rating     | Is worse than   | A     |
| Issues                     | Is greater than | 0     |
| Reliability Rating         | Is worse than   | A     |
| Security hotspots reviewed | Is less than    | 100%  |
| Security Rating            | Is worse than   | A     |

### Check settings outside the profiles and gate

- In both SonarQube Cloud organizations, compare **Administration → New Code** and **Administration → Quality gate
  settings → Ignore duplication and coverage on small changes**. Match the source choices where available. These
  settings affect when the new-code conditions apply. Check organization members and groups, and recreate any
  project-specific webhooks or permission assignments the new projects need.
  [Global analysis setup](https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-organization/setting-config-at-org-level)
- For each imported project, check its GitHub binding, main branch, effective profile and gate, and analysis method.
  If the repository uses a scanner in GitHub Actions, configure the destination Sonar organization and project key,
  grant its `SONAR_TOKEN` access, and disable automatic analysis for that project. Keep project-specific analysis
  exclusions and coverage paths. Run a test PR and confirm that Sonar reports the check on GitHub.
  [Project analysis setup](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/project-analysis)

## 4. Register the organization and run the sync

1. Open [LizardByte/template-base](https://github.com/LizardByte/template-base) and select **Use this template →
   Create a new repository**. Choose the new organization as the owner, name the repository `.github`, and set
   its visibility to **Public**. Replace the template placeholders in the root `README.md` and use the new
   repository's Sonar project key in the badge and in `sonar-project.properties`. Add `profile/README.md`
   with the project's name, LizardByte affiliation, and support links.
   [GitHub organization profile README](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile#adding-a-public-organization-profile-readme)
2. Open a PR in `LizardByte/.github` adding the GitHub organization login to
   [`organizations.json`](../organizations.json) in alphabetical order. The registry enables sync for the new
   organization, including shared settings and custom-property definitions. The replicator discovers existing
   repositories and skips missing `.github` repositories.
3. If the new organization needs shared Actions variables or Actions or Dependabot secrets, add it to the
   applicable entries in [`org-sync.json`](org-sync.json). Select credentials used by its projects. Review
   the PR's **Global replicator** dry run for the new organization, schema changes, and community health files.
   The preview reads the current property inventory. Delivery applies pending schemas before syncing files.
4. After merging, check the delivery run and merge the resulting sync PR in the new `.github` repository.
   To rerun only this organization, use **Global replicator → Run workflow**, fill in **organization**, and
   leave **repository** empty. See the [sync run guide](file-sync.md#reviewing-a-run).
5. On project repositories, set the needed `workflow_profiles` once the schema is available. Review
   the [settings that need manual setup](org-sync.md#transfer-prerequisites) and verify any applicable
   integrations on a project PR, including Codecov's project check and comment. If the project has a
   Pages site, configure its Pages domain and DNS separately.
6. Check the next **Mirror GitHub to GitLab** run. It creates a subgroup under `lizardbyte` when it has a mirror
   to place there. Resolve any existing project occupying `lizardbyte/<org-login-in-lowercase>` before the run
   can create that subgroup.
