Contributing
============

.. Tip:: If this is your first time contributing to an open source project, it is a good idea to read
   MDN's `Basic etiquette for open source projects`_ first. There are a few best practices to adopt that will help
   ensure that you and the other project contributors feel valued and safe, and stay productive.

#. Fork the repository on GitHub
#. Create a new branch for the feature you are adding or the issue you are fixing

   .. Tip:: Base the new branch off the `nightly` branch. It will make your life easier when you submit the PR!

#. Make changes, push commits, etc.
#. Document your code!
#. Test your code!
#. When ready create a PR, following the guidelines below.

Pull Request Guidelines
-----------------------


Pull Request Submission
^^^^^^^^^^^^^^^^^^^^^^^
PRs should be submitted against the `nightly` branch.

   .. Hint:: If you accidentally make your PR against a different branch, a bot will comment letting you know it's on
      the wrong branch. Don't worry. You can edit the PR to change the target branch. There is no reason to close the
      PR!

We do not require that PRs are linked to an issue. That is to say you may submit a PR that fixes an issue for which
there is no GitHub issue. It is not necessary to create an issue before submitting a PR.

Complete the PR template. The templates are written in Markdown. It would be helpful to understand the syntax.
Some common mistakes are listed below.

   - Check boxes should be formatted as follows:

      .. code-block:: markdown

         - [x] This is a complete item
         - [ ] This is an incomplete item

      .. Hint:: The spacing is important. If extra spaces are added, the check box will not render correctly.

   - The issues section should be formatted as a markdown list and use the appropriate keyword to link the issue. Just
     mentioning the issue number will not properly link the PR to the issue. For example:

      .. code-block:: markdown

         - Closes #123
         - Fixes #456
         - Resolves #789

   - Leave the template comments in place. They are helpful when editing the PR description. Comments are
     formatted as follows:

      .. code-block:: markdown

         <!-- This is a comment -->

   - Do not delete sections of the template, even if they don't apply to your PR. It is easier to review a PR when
     it is consistent with the template and other PRs. You can add subsections to the description, by prefixing them
     with `###`.

.. Note:: Draft PRs are also welcome as you work through issues. The benefit of creating a draft PR is that an
  automated build can run in a github runner.


Pull Request Review
^^^^^^^^^^^^^^^^^^^
Pull requests will be reviewed by the project maintainers. In most cases we ask for changes before merging.

The changes requested may be minor, such as fixing a typo, adjusting formatting, or adding a comment. These may seem
like useless requests, but they are important to our projects. They help ensure that the code is readable and
maintainable. They also help ensure that the code is consistent with the rest of the project. Finally, it helps
when the code is revisited in the future.

In other cases the changes request my be more significant. In either case, the maintainers will provide feedback
to help you improve the code.

.. Attention:: Do not expect partially complete PRs to be merged. These topics will be considered before merging.

  - Does the code follows the style guidelines of the project?
  - Is the change value added?
  - Is the code well commented?
  - Were documentation blocks updated for new or modified components?
  - Will the changes create issues in other scenarios?

.. Note:: Developers and maintainers will attempt to assist with challenging issues.


Pull Request Scope
^^^^^^^^^^^^^^^^^^
Normally, PRs should address a single issue or feature. This makes it easier to review and test the code.

In some cases, exceptions may be made. For example, if you find a typo or formatting error in a file being modified,
it may be acceptable to fix it in the same PR as a drive-by fix. However, if the PR is already large, it may be
better to create a separate PR for the secondary fixes.


Code Style Guidelines
---------------------

- Most files, with a few exceptions, should contain an empty line at the end. Some IDEs may remove or add this line
  automatically.
- In most cases, lines should not exceed 120 characters. Keeping lines under this limit makes it easier to read the
  code.
- Lint `yaml` files with `yamllint <https://yamllint.readthedocs.io/>`_ and the
  `configuration file <https://github.com/LizardByte/.github/blob/master/yamllint-config.yml>`_.

Legal
-----
You must sign our CLA (Contributor License Agreement) before we merge your PR. A bot will comment on
your PR if action is necessary.

- `CLA - individual agreement <https://github.com/lizardbyte/.github/blob/master/cla/CLA>`_
- `CLA - entity agreement <https://github.com/lizardbyte/.github/blob/master/cla/CLA-entity>`_

.. Attention:: Follow the instructions provided by the bot to complete signing the contributor license agreement.

Instructions for if you do not own the Copyright in the entire work of authorship Submitted.
   #. Add the owner as a `co-author` to a commit in the PR. See `Creating a commit with multiple authors
      <https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors>`_.
   #. All authors must sign the CLA before it can be merged.

.. _Basic etiquette for open source projects: https://developer.mozilla.org/en-US/docs/MDN/Contribute/Open_source_etiquette
