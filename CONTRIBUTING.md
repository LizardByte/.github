# Contributing

## Guidelines
Thank you for considering contributing to our open source project! We welcome all contributions, whether you're fixing
a bug, improving documentation, or adding a new feature.

Before you start, please take a moment to read our code of conduct and community guidelines, which outline our
expectations for respectful and inclusive behavior.

### Getting Started
1. Fork the repository on GitHub to create a copy of the project.
2. Create a new branch for your changes. This will help if you need to create multiple pull requests, which may be
   out of scope from each other.
3. Make your changes, be sure to follow our code style guidelines and test your code thoroughly.
4. Document your code changes to the best of your ability. This will help other contributors understand the
   purpose and functionality of your changes.
5. You can also add missing documentation to any related code. Documentation is important for the maintainability
   of our projects.
6. When you're ready, submit a pull request using the template provided.

### Pull Requests

#### Creating a Pull Request
To help us review your changes quickly and accurately, please follow these guidelines when submitting a pull request:

1. Submit your pull request against the default branch. The pull request title should follow
   [conventional commit](https://www.conventionalcommits.org/en/v1.0.0/) guidelines. If we accept the PR, it will
   be squashed and merged with the pull request title and number as the commit message.
2. Complete the pull request template, including any relevant details about your changes and any associated issues.

   * Leave the template comments in place. They are helpful when editing the PR description.

     ```markdown
     <!-- This is a comment -->
     ```

   * Do not delete any sections of the template, even if they do not apply to your changes.
   * Link any issues or discussions that are resolved by your changes.

     ```markdown
     - Closes #123
     - Fixes #456
     - Resolves #789
     ```

   * Complete the checklists. It is not required to check everything, only check the items that apply to your changes.

     ```markdown
     - [x] This is a complete item
     - [ ] This is an incomplete item
     ```

3. Be prepared to address any feedback or questions that may arise during the code review process.

> [!NOTE]
> It is important to note that pull requests should generally address a single issue or feature to make it
> easier to review and test the code. In some cases, exceptions may be made. For example, if you find a typo or
> formatting error in a file being modified, it may be acceptable to fix it in the same pull request as a drive-by
> fix. However, if the pull request is already large, it may be better to create a separate pull request for the
> secondary fixes.

#### Review Process
Pull requests will be reviewed by the project maintainers to ensure code quality and consistency with project
standards.

The changes requested may be minor, such as fixing a typo, adjusting formatting, or adding a comment. These may seem
like small requests, but they are important to our projects as they help ensure that the code is readable,
maintainable, and consistent with the rest of the project. In other cases, the requested changes may be more
significant. In either case, the maintainers will provide feedback to help you improve the code.

Please keep in mind that partially complete pull requests will not be merged. Before merging, we will consider the
following criteria:

* Does the code follow the style guidelines of the project?
* Does the change add value?
* Is the code well commented?
* Have documentation blocks been updated for new or modified components?
* Will the changes create issues in other scenarios?

Developers and maintainers will attempt to assist with challenging issues.

### Code Style

#### Code Style Guidelines
We enforce consistent code style across our projects to improve readability and maintainability of the codebase.
Here are some of the guidelines we follow:

- Each file, with few exceptions, should end with an empty line.
- In most cases, the maximum line length should not exceed 120 characters to make the code more readable.
- We use [yamllint](https://yamllint.readthedocs.io) to lint our *yaml* files. You can find the configuration file
  [here](https://github.com/LizardByte/.github/blob/master/yamllint-config.yml) in our *.github* repository.
- We use [CodeQL](https://codeql.github.com/) and [SonarCloud](https://sonarcloud.io/) to analyze our codebases.
  There will be a comment on your PR indicating if there are any issues that need to be addressed.
  Please address these issues if reasonable.
  In some cases, there may be false positives, use your best judgment to determine if changes should be made.
  These tools are not perfect and not meant to override engineering judgment.

### Testing
Testing is a critical part of our development process, and we have automated tests and tools to ensure that our code
meets the expected quality and functionality.

#### Code Style Tests
To ensure consistent code style, we run automated tests on pull requests. The tests that run depend on the labels of
the repository. The following table shows the labels and the corresponding tests that will run:

| Label    | Checks                       |
|----------|------------------------------|
| `python` | `flake8`                     |
| `c++`    | `clang-format`, `cmake-lint` |

Projects may have additional checks, `eslint` for example, depending on the project's requirements.

#### Unit Testing
We strive to have comprehensive unit tests for our projects, but this is still a work in progress for some projects.
We welcome contributions that improve test coverage and add new tests.

In general, PRs should not drastically reduce coverage percentages.
If a change is big enough, tests should be implemented for it.
No one knows your code as well as you do, so you are the best person to write the tests for it.
We understand that not everyone may be experienced with writing tests, so please reach out if you would like some
assistance.

### Legal
We require that all contributors sign a Contributor License Agreement (CLA) before we can merge their pull requests.
If any action is required, a bot will comment on your PR with instructions.
Exempt repositories are listed below.

- Sunshine
- tray
- Virtual-Gamepad-Emulation-Bus
- Virtual-Gamepad-Emulation-dotnet
- Virtual-Gamepad-Emulation-Client

We offer two types of CLAs:

* [CLA for individuals](https://github.com/lizardbyte/.github/blob/master/cla/CLA)
* [CLA for entities](https://github.com/lizardbyte/.github/blob/master/cla/CLA-entity)

If you do not own the Copyright in the entire work of authorship submitted, you must complete the following steps:

1. Add the owner(s) as a *co-author* to a commit in the PR. See
   [Creating a commit with multiple authors](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors).
2. All authors must sign the CLA before it can be merged.