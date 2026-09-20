# Repository standards

This document outlines the standards and best practices for LizardByte repositories to ensure consistency,
maintainability, and quality across all projects.

## Repository structure

### File organization

All repositories should follow a consistent structure:

```text
repository-name/
├── .github/
│   ├── matchers/  # custom problem matchers
│   ├── workflows/
│   │   ├── _codeql.yml
│   │   └── _common-lint.yml
│   ├── dependabot.yml
│   └── semantic.yml
├── branding/  # project specific branding assets
├── docs/  # structure varies depending on the doc system used
├── src/  # main source code
├── tests/  # if there are tests
├── third-party/  # location of submodules if any
├── .gitignore
├── LICENSE
└── README.md or README.rst
```

### Required files

Every repository must include:

- **LICENSE**: All projects must use an appropriate license.
- **README**: Primary documentation in reStructuredText (`.rst`) or Markdown (`.md`) format.
- **.gitignore**: Appropriate for the project's language and framework. See [GitHub's collection](https://github.com/github/gitignore) for starter templates.
- **.github/**: Contains GitHub-specific configurations such as workflows and issue templates.

## Naming conventions

### Repository names

- Be descriptive and concise.
- Avoid abbreviations unless widely understood.

### Branch names

- Use descriptive names with forward slashes for organization.
- Format: `type/short-description`.
- Types include `feat/`, `fix/`, `docs/`, and `refactor/`; see [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for a full list.
- Examples: `feat/user-authentication`, `fix/memory-leak`, `docs/api-reference`.

### File and directory names

- Be consistent within each project.
- Avoid spaces and special characters.

For questions about these standards or exceptions, open an issue in the [.github repository](https://github.com/LizardByte/.github) or contact the maintainers.
