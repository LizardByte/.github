Automations
===========
Our repositories have many automations that help us have consistent and high quality code.

.. Note:: Some of our first repos are lacking in this, but we are working to improve them.

Have suggestions for additional checks for a project? Reach out to us and let us know.

Code Style
----------
We enforce code style guidelines on our projects. The checks that apply depend on the labels of the repository.
These are standard checks which are copied regularly from our ``.github`` repo to each repo.

The tests run will depend on the labels applied to the repository. The following table shows the labels and the
checks that are run.

.. list-table::
   :header-rows: 1

   * - Label
     - Checks
   * - ``python``
     - ``flake8``
   * - ``c++``
     - ``clang-format``, ``cmake-lint``


Code Inspection
---------------
We use `Qodana <https://www.jetbrains.com/qodana/>`_ to inspect our code for common issues. This is run on repositories
that contain a ``qodana-<language>.yml`` file. The file contains the configuration for the inspection. The language
will be one of of the following:

- ``dotnet``
- ``go``
- ``java``
- ``js``
- ``php``
- ``python``

Qodana reports will be published to our `qodana-reports <https://lizardbyte.github.io/qodana-reports>`_ page.

.. Attention:: Reports will be only be published if the ``dispatcher.yml`` file is present on the default branch of
   the repository. This file is used to trigger the publishing of the reports. If reports are not published, it is
   still possible to view them through the normal workflow logs.

Qodana will also annotate the PR files with new issues that it finds. These annotations will be visible in the
`Files Changed` tab of the PR.


Tests
-----
We aim to have additional tests for each project, but not every project has this available. We would welcome
contributions that add to or improve tests.


CI
--
Generally, our repositories have continuous integrations setup. These take care of building the project as needed,
as well as automatically publishing releases.
