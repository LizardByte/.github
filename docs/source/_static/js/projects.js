/**
 * @file projects.js
 * @description Dynamically loads and displays a list of LizardByte projects with documentation hosted on Read the Docs.
 * This script creates a new section on the overview page with a sortable list of active and archived projects.
 */

/**
 * Creates and appends a projects section to the overview element.
 * @returns {HTMLElement|null} The created section element, or null if overview doesn't exist.
 */
function createProjectsSection() {
    const overview = document.getElementById("overview");
    if (!overview) {
        return null;
    }

    const section = document.createElement("section");
    section.className = "active";
    section.id = "projects";

    overview.appendChild(section);
    return section;
}

/**
 * Adds a "Projects" link to the "on this page" table of contents navigation.
 */
function addProjectsToToc() {
    const tocTree = document.getElementsByClassName("toc-tree")[0];
    if (!tocTree) {
        return;
    }

    const tocTreeLists = tocTree.getElementsByTagName("ul");
    if (tocTreeLists.length < 2) {
        return;
    }

    const tocTreeList = tocTreeLists[1];
    const tocListItem = document.createElement("li");

    const tocListItemLink = document.createElement("a");
    tocListItemLink.className = "reference internal";
    tocListItemLink.href = "#projects";
    tocListItemLink.textContent = "Projects";

    tocListItem.appendChild(tocListItemLink);
    tocTreeList.appendChild(tocListItem);
}

/**
 * Creates and appends the heading for the Projects section.
 * @param {HTMLElement} section - The section element to append the heading to.
 */
function createProjectsHeading(section) {
    const heading = document.createElement("h2");
    heading.textContent = "Projects";

    const headingLink = document.createElement("a");
    headingLink.className = "headerlink";
    headingLink.href = "#projects";
    headingLink.title = "Permalink to this headline";
    headingLink.textContent = "#";

    heading.appendChild(headingLink);
    section.appendChild(heading);
}

/**
 * Creates and appends a description paragraph to the Projects section.
 * @param {HTMLElement} section - The section element to append the paragraph to.
 */
function createProjectsDescription(section) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Below is a list of our projects with documentation hosted on Read the Docs.";
    section.appendChild(paragraph);
}

/**
 * Creates and appends an unordered list for projects.
 * @param {HTMLElement} section - The section element to append the list to.
 * @returns {HTMLElement} The created list element.
 */
function createProjectsList(section) {
    const projectList = document.createElement("ul");
    projectList.className = "simple";
    section.appendChild(projectList);
    return projectList;
}

/**
 * Parses project data and extracts relevant information.
 * @param {Object} data - The raw project data from the API.
 * @returns {Array<Object>} An array of project objects with name, url, and archived status.
 */
function parseProjectData(data) {
    const projects = [];

    for (const key in data) {
        if (!Object.hasOwn(data, key)) {
            continue;
        }

        const projectData = data[key];

        // Check if the project is archived
        const archived = projectData.child?.tags?.includes("archived") || false;

        // Create a project object
        const project = {
            name: projectData.child?.name || "Unknown",
            nameLower: (projectData.child?.name || "").toLowerCase(),
            url: projectData.child?.urls?.documentation || "#",
            archived: archived
        };

        projects.push(project);
    }

    return projects;
}

/**
 * Sorts projects by name in ascending order.
 * @param {Array<Object>} projects - The array of project objects to sort.
 * @returns {Array<Object>} The sorted array of projects.
 */
function sortProjects(projects) {
    return projects.sort((a, b) => {
        return a.nameLower.localeCompare(b.nameLower);
    });
}

/**
 * Renders a project list item in the DOM.
 * @param {HTMLElement} projectList - The list element to append the item to.
 * @param {Object} project - The project object containing name, url, and archived status.
 */
function renderProjectItem(projectList, project) {
    const listItem = document.createElement("li");

    const link = document.createElement("a");
    link.href = project.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = project.archived ? `${project.name} (Archived)` : project.name;

    listItem.appendChild(link);
    projectList.appendChild(listItem);
}

/**
 * Renders all projects in the list, with active projects first, then archived.
 * @param {HTMLElement} projectList - The list element to render projects into.
 * @param {Array<Object>} projects - The sorted array of project objects.
 */
function renderProjects(projectList, projects) {
    // Render active projects first
    for (const project of projects) {
        if (!project.archived) {
            renderProjectItem(projectList, project);
        }
    }

    // Then render archived projects
    for (const project of projects) {
        if (project.archived) {
            renderProjectItem(projectList, project);
        }
    }
}

/**
 * Fetches project data from the API endpoint.
 * @param {HTMLElement} projectList - The list element to populate with projects.
 * @returns {Promise<void>}
 */
async function fetchAndRenderProjects(projectList) {
    const apiUrl = "https://app.lizardbyte.dev/dashboard/readthedocs/subprojects/.github.json";

    try {
        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const projects = parseProjectData(data);
        const sortedProjects = sortProjects(projects);

        renderProjects(projectList, sortedProjects);
    } catch (error) {
        console.error("Error fetching projects:", error);

        // Display error message to user
        const errorItem = document.createElement("li");
        errorItem.textContent = "Failed to load projects. Please try again later.";
        errorItem.style.color = "red";
        projectList.appendChild(errorItem);
    }
}

/**
 * Initializes the projects section on the page.
 * This is the main entry point that orchestrates all the functionality.
 */
function initializeProjectsSection() {
    const section = createProjectsSection();

    // If we're not on the right page, exit early
    if (!section) {
        return;
    }

    addProjectsToToc();
    createProjectsHeading(section);
    createProjectsDescription(section);

    const projectList = createProjectsList(section);
    fetchAndRenderProjects(projectList);
}

// Initialize when DOM is fully loaded
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeProjectsSection);
} else {
    // DOM is already loaded
    initializeProjectsSection();
}
