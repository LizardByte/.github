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
    'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',  # jquery, required for ajax request
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
