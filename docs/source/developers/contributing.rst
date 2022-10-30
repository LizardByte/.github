Contributing
============

.. Tip:: If this is your first time contributing to an open source project, it is a good idea to read
   MDN's `Basic etiquette for open source projects`_ first. There are a few best practices to adopt that will help
   ensure that you and the other project contributors feel valued and safe, and stay productive.

#. Fork the repo on GitHub
#. Create a new branch for the feature you are adding or the issue you are fixing

   .. Tip:: Base the new branch off the `nightly` branch. It will make your life easier when you submit the PR!

#. Make changes, push commits, etc.
#. Files should contain an empty line at the end.
#. Document your code!
#. Test your code!
#. When ready create a PR against the `nightly` branch.

   .. Hint:: If you accidentally make your PR against a different branch, a bot will comment letting you know it's on
      the wrong branch. Don't worry. You can edit the PR to change the target branch. There is no reason to close the
      PR!

   .. Note:: Draft PRs are also welcome as you work through issues. The benefit of creating a draft PR is that an
      automated build can run in a github runner.

   .. Attention:: Do not expect partially complete PRs to be merged. These topics will be considered before merging.

      - Does the code follows the style guidelines of the project?
         .. Tip:: Look at examples of existing code in the project!

      - Is the change value added?
      - Is the code well commented?
      - Were documentation blocks updated for new or modified components?

   .. Note:: Developers and maintainers will attempt to assist with challenging issues.

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
