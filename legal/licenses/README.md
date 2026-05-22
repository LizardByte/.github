# LizardByte License Usage

This directory contains LizardByte-maintained license texts.

## LB-SAL Identity

- Full name: LizardByte Source-Available License 1.0
- Short name: LB-SAL 1.0
- SPDX custom identifier: `LicenseRef-LizardByte-SAL-1.0`
- Canonical text in this repository: `legal/licenses/LizardByte-SAL-1.0.md`

LB-SAL is not on the SPDX License List, so do not use `LB-SAL` by itself as an
SPDX license identifier. Use the `LicenseRef-...` identifier above anywhere an
SPDX expression accepts custom license references.

## Applying LB-SAL To A Repository

For a single-license repository:

1. Copy `legal/licenses/LizardByte-SAL-1.0.md` into the target repository as
   `LICENSE` or `LICENSE.md`.
2. Add a clear notice to the target repository README:

   ```md
   This project is licensed under the LizardByte Source-Available License 1.0
   (LB-SAL 1.0). See [LICENSE](LICENSE).
   ```

3. Add SPDX headers to source files where practical:

   ```text
   SPDX-License-Identifier: LicenseRef-LizardByte-SAL-1.0
   ```

4. Keep existing third-party, vendored, generated, or differently licensed file
   notices intact. Do not replace their original license notices with LB-SAL.

The license applies to software that includes a notice stating that it is
licensed under LB-SAL. A license file alone is useful, but a project-level or
file-level notice makes the intended application explicit.

## SPDX Headers

Use one SPDX license line per file, formatted for that file's comment syntax.
Examples:

```c
// SPDX-License-Identifier: LicenseRef-LizardByte-SAL-1.0
```

```python
# SPDX-License-Identifier: LicenseRef-LizardByte-SAL-1.0
```

```html
<!-- SPDX-License-Identifier: LicenseRef-LizardByte-SAL-1.0 -->
```

For REUSE-style projects, add copyright metadata too:

```python
# SPDX-FileCopyrightText: 2026 David Lane
# SPDX-License-Identifier: LicenseRef-LizardByte-SAL-1.0
```

If a file is dual-licensed or has multiple applicable licenses, use a valid SPDX
license expression, for example:

```text
SPDX-License-Identifier: LicenseRef-LizardByte-SAL-1.0 OR MIT
```

Only use `OR` when recipients may choose either license. Use `AND` only when
recipients must comply with both licenses at the same time.

## REUSE Layout

Projects following the REUSE specification should place the license text at:

```text
LICENSES/LicenseRef-LizardByte-SAL-1.0.md
```

They may also keep a root `LICENSE` file for GitHub, package managers, and human
readers.

## Package Metadata

Different package ecosystems handle custom licenses differently. Prefer the
ecosystem-specific form below.

### npm `package.json`

npm documents custom licenses using `SEE LICENSE IN <filename>`:

```json
{
  "license": "SEE LICENSE IN LICENSE"
}
```

Include the referenced `LICENSE` file at the top level of the package.

### Python `pyproject.toml`

Modern Python packaging supports SPDX expressions, including custom
`LicenseRef-...` identifiers:

```toml
[project]
license = "LicenseRef-LizardByte-SAL-1.0"
license-files = ["LICENSE"]
```

### Rust `Cargo.toml`

crates.io expects `license` to use known SPDX License List identifiers. For a
nonstandard license, use `license-file` instead:

```toml
[package]
license-file = "LICENSE"
```

### NuGet `.csproj`

NuGet.org accepts expression metadata only for supported license expressions.
For a custom license, pack the license file:

```xml
<PropertyGroup>
  <PackageLicenseFile>LICENSE.md</PackageLicenseFile>
</PropertyGroup>

<ItemGroup>
  <None Include="LICENSE.md" Pack="true" PackagePath="" />
</ItemGroup>
```

### NuGet `.nuspec`

Use a file license entry and include the file in the package:

```xml
<license type="file">LICENSE.md</license>
```

### Maven `pom.xml`

Maven recommends using an SPDX identifier as the license name. For LB-SAL, use
the custom SPDX identifier and point to the license text:

```xml
<licenses>
  <license>
    <name>LicenseRef-LizardByte-SAL-1.0</name>
    <url>https://github.com/LizardByte/.github/blob/master/legal/licenses/LizardByte-SAL-1.0.md</url>
    <distribution>repo</distribution>
  </license>
</licenses>
```

### SPDX SBOMs

Use the same custom identifier in SPDX package fields, and include extracted
license text for the `LicenseRef` in the SBOM:

```text
PackageLicenseDeclared: LicenseRef-LizardByte-SAL-1.0
```

## Notes

- GitHub license detection primarily matches root license files against known
  licenses, so a custom source-available license may not show a recognized
  GitHub license badge.
- Do not use `UNLICENSED` for LB-SAL projects. `UNLICENSED` communicates that no
  rights are granted; LB-SAL grants specific limited rights.
- Do not mark LB-SAL projects as open source unless the project is also released
  under an OSI-approved open source license.

## References

- SPDX license identifiers and expressions:
  https://spdx.dev/learn/handling-license-info/
- SPDX LicenseRef syntax:
  https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/
- REUSE license file layout:
  https://reuse.software/spec-3.2/
- GitHub license detection:
  https://docs.github.com/en/rest/licenses/licenses#about-licenses
- npm package license metadata:
  https://docs.npmjs.com/cli/v8/configuring-npm/package-json/#license
- Python license metadata:
  https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#license-and-license-files
- Cargo license metadata:
  https://doc.rust-lang.org/cargo/reference/manifest.html#the-license-and-license-file-fields
- NuGet license metadata:
  https://learn.microsoft.com/en-us/nuget/reference/nuspec#license
- Maven license metadata:
  https://maven.apache.org/pom.html#Licenses
