Contributing Guidelines
=======================
Thank you for considering contributing to our open source project! We welcome all contributions, whether you're fixing
a bug, improving documentation, or adding a new feature.

Before you start, please take a moment to read our code of conduct and community guidelines, which outline our
expectations for respectful and inclusive behavior.

Getting Started
---------------
#. Fork the repository on GitHub to create a copy of the project.
#. Create a new branch for your changes, based on the latest version of the ``nightly`` branch. This will help avoid
   conflicts when submitting your pull request.
#. Make your changes, being sure to follow our code style guidelines and test your code thoroughly.
#. Document any changes you make to the code or documentation, to help other contributors understand the purpose
   and functionality of your changes.
#. When you're ready, submit a pull request using the template provided.

Pull Requests
-------------

Creating a Pull Request
^^^^^^^^^^^^^^^^^^^^^^^
To help up review your changes quickly and accurately, please follow these guidelines when submitting a pull request:

#. Submit your pull request against the ``nightly`` branch. If you make a mistake this can be edited without opening
   a new PR.
#. Complete the pull request template, including any relevant details about your changes and any associated issues.

   * Leave the template comments in place. They are helpful when editing the PR description.

     .. code-block:: markdown

        <!-- This is a comment -->

   * Do not delete any sections of the template, even if they do not apply to your changes.
   * Link any issues or discussions that are resolved by your changes.

     .. code-block:: markdown

        - Closes #123
        - Fixes #456
        - Resolves #789

   * Complete the checklists. It is not required to check everything, only check the items that apply to your changes.

     .. code-block:: markdown

        - [x] This is a complete item
        - [ ] This is an incomplete item

#. Be prepared to address any feedback or questions that may arise during the code review process.

.. Note:: It is important to note that pull requests should generally address a single issue or feature to make it
   easier to review and test the code. In some cases, exceptions may be made. For example, if you find a typo or
   formatting error in a file being modified, it may be acceptable to fix it in the same pull request as a drive-by
   fix. However, if the pull request is already large, it may be better to create a separate pull request for the
   secondary fixes.

Review Process
^^^^^^^^^^^^^^
Pull requests will be reviewed by the project maintainers to ensure code quality and consistency with project
standards.

The changes requested may be minor, such as fixing a typo, adjusting formatting, or adding a comment. These may seem
like small requests, but they are important to our projects as they help ensure that the code is readable,
maintainable, and consistent with the rest of the project. In other cases, the requested changes may be more
significant. In either case, the maintainers will provide feedback to help you improve the code.

Please keep in mind that partially complete pull requests will not be merged. Before merging, we will consider the
following criteria:

- Does the code follow the style guidelines of the project?
- Does the change add value?
- Is the code well commented?
- Have documentation blocks been updated for new or modified components?
- Will the changes create issues in other scenarios?

Developers and maintainers will attempt to assist with challenging issues.

Code Style
----------

Code Style Guidelines
^^^^^^^^^^^^^^^^^^^^^
We enforce consistent code style across our projects to improve readability and maintainability of the codebase.
Here are some of the guidelines we follow:

- Each file, with few exceptions, should end with an empty line.
- In most cases, the maximum line length should not exceed 120 characters to make the code more readable.
- We use `yamllint <https://yamllint.readthedocs.io/>`_ to lint our `yaml` files. You can find the configuration file
  `here <https://github.com/LizardByte/.github/blob/master/yamllint-config.yml>`_ in our `.github` repository.

Testing
-------
Testing is a critical part of our development process, and we have automated tests and tools to ensure that our code
meets the expected quality and functionality.

Code Style Tests
^^^^^^^^^^^^^^^^
To ensure consistent code style, we run automated tests on pull requests. The tests that run depend on the labels of
the repository. The following table shows the labels and the corresponding tests that will run:

.. list-table::
   :header-rows: 1

   * - Label
     - Checks
   * - ``python``
     - ``flake8``
   * - ``c++``
     - ``clang-format``, ``cmake-lint``

Code Inspection Tests
^^^^^^^^^^^^^^^^^^^^^
We use `Qodana <https://www.jetbrains.com/qodana/>`_ to inspect our code for common issues. Qodana will run if the
repository contains a ``qodana-<language>.yml`` file. The file contains the configuration for the inspection.
The supported languages are:

- ``dotnet``
- ``go``
- ``java``
- ``js``
- ``php``
- ``python``

We publish Qodana reports to our `qodana-reports <https://lizardbyte.github.io/qodana-reports>`_ page. To publish
reports, the ``dispatcher.yml`` file should be present on the default branch of the repository. If the reports are not
published, you can still view them through the workflow logs.

Qodana also annotates the PR files with any new issues it finds. You can view these annotations in the `Files Changed`
tab of the PR.

Unit Testing
^^^^^^^^^^^^
We strive to have comprehensive unit tests for our projects, but this is still a work in progress for some projects.
We welcome contributions that improve test coverage and add new tests.

Legal
-----
We require that all contributors sign a Contributor License Agreement (CLA) before we can merge their pull requests.
If any action is required, a bot will comment on your PR with instructions.

We offer two types of CLAs:

- `CLA for individuals <https://github.com/lizardbyte/.github/blob/master/cla/CLA>`_
- `CLA for entities <https://github.com/lizardbyte/.github/blob/master/cla/CLA-entity>`_

If you do not own the Copyright in the entire work of authorship submitted, you must complete the following steps:

#. Add the owner(s) as a `co-author` to a commit in the PR. See `Creating a commit with multiple authors
   <https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors>`_.
#. All authors must sign the CLA before it can be merged.
