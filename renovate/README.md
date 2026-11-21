# Renovate

## CPM package lock

The shared CPM preset reads annotated `package-lock.cmake` files at the repository root or in a
subdirectory. Projects including build-deps, Sunshine, Moonlight-XboxOG, libvirtualhid, and lizardbyte-common
inherit the preset through `local>LizardByte/.github:renovate-config` in `renovate.json`. [CPM preset](cmake.json5).

When adding a lock file to a project, commit it, load it with `CPMUsePackageLock` after including CPM, and call
`CPMGetPackage` with the first argument of `CPMDeclarePackage`. Set `NAME` to the name accepted by `find_package`
when the dependency supports local packages. If a project includes a shared lock file, update the pin in the
repository that owns it. Sunshine includes shared FFmpeg pins this way.
[Sunshine CMake setup](https://github.com/LizardByte/Sunshine/blob/master/CMakeLists.txt).

### Annotation layout

1. Start each dependency block with a comment naming the dependency.
2. Add `# renovate: datasource=... depName=...` directly below it. Use the upstream project for `depName`.
3. For version or tag pins, keep optional keys in the order `packageName`, `versioning`, `extractVersion`, `registryUrl`. Put them on the `# renovate:` line or on consecutive `# key=value` lines.
4. Follow the metadata with `set(NAME_VERSION ...)` or `set(NAME_TAG ...)`, and place `CPMDeclarePackage(...)`
   below the tracked assignments.

### GitHub tags

For `github-tags`, Renovate derives `owner/repo` from a literal GitHub HTTPS URL on the `GIT_REPOSITORY` line.
The `.git` suffix is optional. This allows `depName` to identify the upstream project when CPM fetches from a
mirror. An explicit `packageName=owner/repo` takes precedence. When neither is present, including declarations
that use `GITHUB_REPOSITORY` or an archive `URL`, Renovate uses `depName`.
[SVT-AV1 in build-deps](https://github.com/LizardByte/build-deps/blob/master/package-lock.cmake).

Store the full tag in `NAME_TAG`, or use `extractVersion` with a named `version` group to store a version
without the tag prefix. Reconstruct the tag in the declaration when storing only the version.
[SDL in libvirtualhid](https://github.com/LizardByte/libvirtualhid/blob/master/package-lock.cmake).

```cmake
# SDL
# renovate: datasource=github-tags depName=libsdl-org/SDL versioning=semver
# extractVersion=^release-(?<version>\d+\.\d+\.\d+)$
set(SDL3_VERSION 3.4.12)
CPMDeclarePackage(SDL3
        NAME SDL3
        VERSION ${SDL3_VERSION}
        GITHUB_REPOSITORY libsdl-org/SDL
        GIT_TAG release-${SDL3_VERSION}
)
```

### Release archives with SHA256 checksums

Use a datasource that can supply the archive digest, such as `github-release-attachments`. Put
`set(NAME_SHA256 ...)` immediately after the version or tag assignment and pass its value to `URL_HASH`.
[Boost in Sunshine](https://github.com/LizardByte/Sunshine/blob/master/package-lock.cmake).

```cmake
# Boost
# renovate: datasource=github-release-attachments depName=boostorg/boost
# versioning=regex:^boost-(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$
set(BOOST_TAG boost-1.92.0)
set(BOOST_SHA256 9bed76128d4e46755dbe818487788c6fceb6f72b378f4daa49b7e1e600d9088d)
string(REGEX REPLACE "^boost-" "" BOOST_VERSION "${BOOST_TAG}")
CPMDeclarePackage(Boost
        NAME Boost
        VERSION ${BOOST_VERSION}
        URL https://github.com/boostorg/boost/releases/download/${BOOST_TAG}/${BOOST_TAG}-cmake.tar.xz
        URL_HASH SHA256=${BOOST_SHA256}
        DOWNLOAD_ONLY YES
)
```

### Git branch commits

For `git-refs`, add `# ref=<branch>` after the metadata and set `NAME_COMMIT` to the full 40-character hash.
Renovate uses the full literal URL on the `GIT_REPOSITORY` line of the package declaration. To override it
or supply the URL for a declaration that uses a variable, put `packageName=<git-url>` before `# ref=`.
The build stays pinned to the hash while Renovate follows the branch.
[Moonlight-XboxOG lock file](https://github.com/LizardByte/Moonlight-XboxOG/blob/master/package-lock.cmake),
[build-deps lock file](https://github.com/LizardByte/build-deps/blob/master/package-lock.cmake).

```cmake
# x264
# renovate: datasource=git-refs depName=videolan/x264
# ref=stable
set(X264_COMMIT b35605ace3ddf7c1a5d67a2eb553f034aef41d55)
CPMDeclarePackage(x264
        NAME x264
        GIT_REPOSITORY https://github.com/LizardByte-infrastructure/x264.git
        GIT_TAG ${X264_COMMIT}
        DOWNLOAD_ONLY YES
)
```

## Flatpak modules

The shared Flatpak preset reads annotated JSON sources under `packaging/linux/flatpak/modules/`,
including nested modules. Projects inherit it through `local>LizardByte/.github:renovate-config` in
`renovate.json`. [Flatpak preset](flatpak.json5).

### Annotation layout

1. Add an `x-renovate` object to each source Renovate should update. Place it immediately before
   `url`.
2. List `datasource` and `depName` first, followed by `packageName` and `versioning` when needed.
   Renovate uses `depName` for the lookup unless you supply `packageName`.
3. Keep the fields for the pin together and in order. For Git sources, use `url`, then `tag` or
   `branch`, then `commit`. For GitHub release assets, use `url` followed by `sha256`.
4. Keep `x-checker-data` for Flatpak External Data Checker after the pin fields.

For a source maintained through Flatpak External Data Checker, you can record that choice with
`"x-renovate": {"depName": "libtirpc", "enabled": false}`.

### Git tags and branches

Use `github-tags` for a GitHub tag pinned by commit. For a mirrored project, set `depName` to the
upstream name and `packageName` to the mirror's GitHub `owner/repo`. Flatpak checks out the Git
repository specified by `url`.

```json
{
  "type": "git",
  "x-renovate": {
    "datasource": "github-tags",
    "depName": "xorg/xserver",
    "packageName": "LizardByte-infrastructure/xserver",
    "versioning": "regex:^xorg-server-(?<major>[0-9]+)[.](?<minor>[0-9]+)[.](?<patch>[0-9]+)$"
  },
  "url": "https://github.com/LizardByte-infrastructure/xserver.git",
  "tag": "xorg-server-21.1.13",
  "commit": "be2767845d6ed3c6dbd25a151051294d0908a995"
}
```

To follow a branch, use `git-refs`, set `packageName` to the full Git URL, use `exact` versioning,
and specify `branch` followed by the pinned `commit`.

For a commit-only checkout, put `"ref": "main"` last in `x-renovate` and use `url` followed by
`commit` in the source. Renovate follows that ref while Flatpak checks out the pinned commit.
Renovate uses the source URL as `packageName` by default and uses `exact` versioning. For a mirror,
use the upstream project as `depName` and the full mirror URL as `packageName`.

### GitHub release assets

Use `github-release-attachments` for an archive or file from a GitHub release. Keep the full tag
in the download URL so Renovate can update the URL and SHA-256 together. Set `versioning` for
nonstandard tags.

```json
{
  "type": "archive",
  "x-renovate": {
    "datasource": "github-release-attachments",
    "depName": "boostorg/boost",
    "versioning": "regex:^boost-(?<major>[0-9]+)[.](?<minor>[0-9]+)[.](?<patch>[0-9]+)(?<prerelease>[.][A-Za-z0-9.-]+)?$"
  },
  "url": "https://github.com/boostorg/boost/releases/download/boost-1.92.0/boost-1.92.0-cmake.tar.xz",
  "sha256": "9bed76128d4e46755dbe818487788c6fceb6f72b378f4daa49b7e1e600d9088d"
}
```

Use the same `depName` and compatible versioning across sources that track the same dependency.
Renovate can then group matching updates from different architecture assets and the CPM lock
into one pull request.
