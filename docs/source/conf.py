# Configuration file for the Sphinx documentation builder.
#
# This file only contains a selection of the most common options. For a full
# list see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# standard imports
from datetime import datetime
import os

# -- Path setup --------------------------------------------------------------

# If extensions (or modules to document with autodoc) are in another directory,
# add these directories to sys.path here. If the directory is relative to the
# documentation root, use os.path.abspath to make it absolute, like shown here.

script_dir = os.path.dirname(os.path.abspath(__file__))  # the directory of this file
source_dir = os.path.dirname(script_dir)  # the source folder directory
root_dir = os.path.dirname(source_dir)  # the root folder directory

# -- Project information -----------------------------------------------------
project = 'LizardByte'
project_copyright = f'{datetime.now().year}, {project}'
author = 'ReenigneArcher'

# The full version, including alpha/beta/rc tags
version = os.getenv('READTHEDOCS_VERSION', 'latest')

# -- General configuration ---------------------------------------------------

# Add any Sphinx extension module names here, as strings. They can be
# extensions coming with Sphinx (named 'sphinx.ext.*') or your custom
# ones.
extensions = [
    'myst_parser',  # enable markdown files
    'sphinx.ext.autosectionlabel',
    'sphinx.ext.todo',  # enable to-do sections
    'sphinx.ext.viewcode',  # add links to view source code
    'sphinx_copybutton',  # add a copy button to code blocks
]

# https://myst-parser.readthedocs.io/en/latest/syntax/optional.html
myst_enable_extensions = [
    "colon_fence",  # Only enabled so we can implement am adhoc fix to render GitHub admonitions
]

# Add any paths that contain templates here, relative to this directory.
# templates_path = ['_templates']

# List of patterns, relative to source directory, that match files and
# directories to ignore when looking for source files.
# This pattern also affects html_static_path and html_extra_path.
exclude_patterns = ['toc.rst']

# Extensions to include.
source_suffix = {
    '.rst': 'restructuredtext',
    '.md': 'markdown',
}


# -- Options for HTML output -------------------------------------------------

# images
html_favicon = os.path.join(root_dir, 'branding', 'logos', 'favicon.ico')
html_logo = os.path.join(root_dir, 'branding', 'logos', 'logo-512x512.png')

# Add any paths that contain custom static files (such as style sheets) here,
# relative to this directory. They are copied after the builtin static files,
# so a file named "default.css" will overwrite the builtin "default.css".
html_static_path = ['_static']

# These paths are either relative to html_static_path
# or fully qualified paths (eg. https://...)
html_css_files = [
    'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@2025.326.11214/dist/crowdin-furo-css.css',
]
html_js_files = [
    'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@2025.326.11214/dist/crowdin.js',
    'https://cdn.jsdelivr.net/npm/@lizardbyte/shared-web@2025.326.11214/dist/ranking-sorter.js',
    'js/crowdin.js',  # crowdin language selector
    'js/projects.js',  # load projects with readthedocs documentation
]

# The theme to use for HTML and HTML Help pages.  See the documentation for
# a list of builtin themes.
html_theme = 'furo'

html_theme_options = {
    "top_of_page_button": "edit",
    "source_edit_link": "https://github.com/lizardbyte/.github/blob/master/docs/source/{filename}",
}

# extension config options
autosectionlabel_prefix_document = True  # Make sure the target is unique
todo_include_todos = True

# disable epub mimetype warnings
# https://github.com/readthedocs/readthedocs.org/blob/eadf6ac6dc6abc760a91e1cb147cc3c5f37d1ea8/docs/conf.py#L235-L236
suppress_warnings = ["epub.unknown_project_files"]


# Issue https://github.com/executablebooks/MyST-Parser/issues/845
# GitHub admonitions with Sphinx/MyST
# Workaround template adapted from (with some changes):
# https://github.com/python-project-templates/yardang/blob/f77348d45dcf0eb130af304f79c0bfb92ab90e0c/yardang/conf.py.j2#L156-L188

# https://spdx.github.io/spdx-spec/v2.3/file-tags/#h3-snippet-tags-format
# SPDX-SnippetBegin
# SPDX-License-Identifier: Apache-2.0
# SPDX-SnippetCopyrightText: Tim Paine / the yardang authors <t.paine154@gmail.com">

_GITHUB_ADMONITIONS = {
    "> [!NOTE]": "note",
    "> [!TIP]": "tip",
    "> [!IMPORTANT]": "important",
    "> [!WARNING]": "warning",
    "> [!CAUTION]": "caution",
}


def convert_gh_admonitions(app, relative_path, parent_docname, contents):
    # TODO handle nested directives -> recursion
    # loop through content lines, replace github admonitions
    for i, orig_content in enumerate(contents):
        orig_line_splits = orig_content.split("\n")
        replacing = False
        for j, line in enumerate(orig_line_splits):
            # look for admonition key
            line_roi = line.lstrip()
            for admonition_key in _GITHUB_ADMONITIONS:
                if line_roi.startswith(admonition_key):
                    line = line.replace(admonition_key, ":::{" + _GITHUB_ADMONITIONS[admonition_key] + "}")
                    # start replacing quotes in subsequent lines
                    replacing = True
                    break
            else:  # no break
                if not replacing:
                    continue
                # remove GH directive to match MyST directive
                # since we are replacing on the original line, this will preserve the right indent, if any
                if line_roi.startswith("> "):
                    line = line.replace("> ", "", 1)
                elif line_roi.rstrip() == ">":
                    line = line.replace(">", "", 1)
                else:
                    # missing "> ", so stop replacing and terminate directive
                    line = f":::\n{line}"
                    replacing = False
            # swap line back in splits
            orig_line_splits[j] = line
        # swap line back in original
        contents[i] = "\n".join(orig_line_splits)

# SPDX-SnippetEnd


def setup(app):
    app.connect("include-read", convert_gh_admonitions)
