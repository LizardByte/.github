// custom javascript to get a list of other LizardByte projects using Readthedocs

// wait until ready
$(document).ready(function() {
    // get element by id
    let overview = document.getElementById("overview")

    // create a new section
    let section = document.createElement("section")
    section.className = "active"
    section.id = "projects"

    // add it to the overview
    try {
        overview.appendChild(section)
    }
    catch {
        return  // not the right page
    }

    // add projects to the "on this page" table of contents
    // get the first element with toc-tree class
    let toc_tree = document.getElementsByClassName("toc-tree")[0]
    // get the second ul element in the toc-tree
    let toc_tree_list = toc_tree.getElementsByTagName("ul")[1]
    // create a new list item
    let toc_list_item = document.createElement("li")
    toc_tree_list.appendChild(toc_list_item)
    // create the link
    let toc_list_item_link = document.createElement("a")
    toc_list_item_link.className = "reference internal"
    toc_list_item_link.href = "#projects"
    toc_list_item_link.textContent = "Projects"
    toc_list_item.appendChild(toc_list_item_link)

    // create a new h2 heading
    let heading = document.createElement("h2")
    heading.textContent = "Projects"
    section.appendChild(heading)

    let heading_link = document.createElement("a")
    heading_link.className = "headerlink"
    heading_link.href = "#projects"
    heading_link.title = "Permalink to this headline"
    heading_link.textContent = "#"
    heading.appendChild(heading_link)

    // create a new paragraph
    let paragraph = document.createElement("p")
    paragraph.textContent = "Below is a list of our projects with documentation hosted on Read the Docs."
    section.appendChild(paragraph)

    // create a new unordered list
    let project_list = document.createElement("ul")
    project_list.className = "simple"
    section.appendChild(project_list)

    // get project data using ajax
    $.ajax({
        url: "https://app.lizardbyte.dev/dashboard/readthedocs/subprojects/.github.json",
        dataType: "json",
        success: function(data) {
            // create a projects list
            let projects = []

            for (let i in data) {
                // check if the project is archived
                let archived = false
                for (let tag in data[i]['child']['tags']) {
                    if (data[i]['child']['tags'][tag] === "archived") {
                        archived = true
                    }
                }

                // create a new project dictionary
                let project = {
                    'name': data[i]['child']['name'],
                    'name_lower': data[i]['child']['name'].toLowerCase(),
                    'url': data[i]['child']['urls']['documentation'],
                    'archived': archived
                }

                // add the project to the list
                projects.push(project)
            }

            // sort the projects by name
            let sorted_projects = projects.sort(rankingSorter('name_lower', 'name')).reverse()

            for (let a of [false, true]) {
                for (let i in sorted_projects) {
                    if (sorted_projects[i]['archived'] === a) {
                        // create a new list item
                        let project_list_item = document.createElement("li")
                        project_list.appendChild(project_list_item)

                        // create a new link
                        let project_list_item_link = document.createElement("a")
                        project_list_item_link.href = sorted_projects[i]['url']
                        project_list_item_link.target = "_blank"
                        project_list_item_link.textContent = sorted_projects[i]['name'] + (a ? " (Archived)" : "")
                        project_list_item.appendChild(project_list_item_link)
                    }
                }
            }
        }

    })  // end ajax
})
