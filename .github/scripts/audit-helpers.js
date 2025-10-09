/**
 * Repository auditing script for GitHub Actions
 * This script fetches all repositories in an organization and runs various audits on them.
 */

/**
 * Report failures for a given check
 * @param {Object} core - GitHub Actions core object
 * @param {string} checkName - Name of the check being performed
 * @param {Array} failures - Array of failure objects with repo, html_url, and issues properties
 * @param {string} icon - Icon to display for failures (default: '❌')
 */
function reportFailures(core, checkName, failures, icon = '❌') {
  if (failures.length > 0) {
    failures.forEach(failure => {
      console.log(`${icon} ${failure.repo}:`);
      failure.issues.forEach(issue => console.log(`   - ${issue}`));
      console.log(`   URL: ${failure.html_url}\n`);
    });
    core.setFailed(`${failures.length} ${checkName} check(s) failed. See logs above for details.`);
  } else {
    console.log(`\n✅ All ${checkName} checks passed!`);
  }
}

/**
 * Validate repository description
 * @param {Object} repo - Repository object
 * @returns {Array} Array of issue strings
 */
function validateDescription(repo) {
  const issues = [];

  // Check if description exists
  if (!repo.description) {
    issues.push('Missing description');
  } else {
    // Ensure the description does not begin or end with whitespace
    if (repo.description !== repo.description.trim()) {
        issues.push('Description contains leading or trailing whitespace');
    }

    // Ensure the description ends with a period
    if (!repo.description.endsWith('.')) {
      issues.push('Description does not end with a period');
    }

    // Ensure the description is not too short
    if (repo.description.length < 10) {
      issues.push('Description is too short (less than 10 characters)');
    }
  }

  return issues;
}

/**
 * Validate repository settings
 * @param {Object} repo - Repository object
 * @returns {Array} Array of issue strings
 */
function validateSettings(repo) {
  const issues = [];

  // Ensure issues are enabled
  if (!repo.has_issues) {
    issues.push('Issues are disabled');
  }

  return issues;
}

/**
 * Run an audit check on all repositories
 * @param {Object} core - GitHub Actions core object
 * @param {Array} repos - Array of repository objects
 * @param {string} checkName - Name of the check being performed
 * @param {Function} validationFn - Function that takes a repo and returns an array of issues
 * @param {string} icon - Icon to display for failures (default: '❌')
 */
function runAudit(core, repos, checkName, validationFn, icon = '❌') {
  const failures = [];

  console.log(`=== Checking ${checkName} ===\n`);

  for (const repo of repos) {
    const issues = validationFn(repo);

    if (issues.length > 0) {
      failures.push({
        repo: repo.name,
        html_url: repo.html_url,
        issues: issues
      });
    } else {
      console.log(`✅ ${repo.name}`);
    }
  }

  reportFailures(core, checkName, failures, icon);
}

/**
 * Fetch all active (non-archived) repositories from the organization
 * @param {Object} github - GitHub API object
 * @param {Object} context - GitHub Actions context
 * @returns {Promise<Array>} Array of repository objects
 */
async function fetchRepositories(github, context) {
  console.log('=== Fetching Repositories ===\n');

  const opts = github.rest.repos.listForOrg.endpoint.merge({
    org: context.repo.owner,
    per_page: 100
  });
  const allRepos = await github.paginate(opts);

  // filter out archived repos
  const repos = allRepos.filter(repo => !repo.archived);

  console.log(`Found ${repos.length} active repositories to audit\n`);

  // return repo data needed for validation
  return repos.map(repo => ({
    name: repo.name,
    description: repo.description || '',
    html_url: repo.html_url,
    has_issues: repo.has_issues,
    has_wiki: repo.has_wiki,
    has_projects: repo.has_projects
  }));
}

/**
 * Main audit function - fetches repos and runs all audits
 * @param {Object} github - GitHub API object
 * @param {Object} context - GitHub Actions context
 * @param {Object} core - GitHub Actions core object
 */
async function auditRepositories(github, context, core) {
  // Fetch all repositories
  const repos = await fetchRepositories(github, context);

  // Define all audits to run
  const audits = [
    { name: 'Repository Descriptions', fn: validateDescription },
    { name: 'Repository Settings', fn: validateSettings }
  ];

  // Run all audits
  let hasFailures = false;
  for (const audit of audits) {
    try {
      runAudit(core, repos, audit.name, audit.fn);
    } catch (error) {
      // runAudit will set the failure, but we need to continue with other audits
      hasFailures = true;
    }
    console.log(''); // Add spacing between audit sections
  }

  // Summary
  console.log('=== Audit Summary ===');
  console.log(`Total repositories audited: ${repos.length}`);
  console.log(`Total audits performed: ${audits.length}`);
  console.log(`\nWorkflow completed. Check sections above for detailed results.`);
}

module.exports = {
  auditRepositories,
  reportFailures,
  validateDescription,
  validateSettings,
  runAudit,
  fetchRepositories
};
