:github_url: https://github.com/LizardByte/.github/tree/nightly/docs/source/developers/automations.rst

Automations
===========
Our repositories have many automations that help us have consistent and high quality code.

.. Note:: Some of our first repos are lacking in this, but we are working to improve them.

Have suggestions for additional checks for a project? Reach out to us and let us know.

Code Style
----------
We enforce code style guidelines on our projects. The checks that apply depend on the labels of the repository.
These are standard checks which are copied regularly from our ``.github`` repo to each repo.

For example, repositories with the ``python`` label will have ``flake8`` tests.


Tests
-----
We aim to have additional tests for each project, but not every project has this available. We would welcome
contributions that add to or improve tests.


CI
--
Generally, our repositories have continuous integrations setup. These take care of building the project as needed,
as well as automatically publishing releases.
