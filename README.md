# github-workflows

Reusable GitHub Actions workflows and composite actions that build, version and release all my
repositories. A repository calls one workflow from a small `ci.yaml`; everything else (version bump,
release commit and tag, image or package publishing) happens here.

Use them through the moving `v1` tag, which CI moves on every release of this repository.

## Use a workflow

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]
    paths-ignore: [.github/**, "**.md", renovate.json, LICENSE]
  workflow_dispatch:
    inputs:
      version_bump:
        description: Version part to bump
        type: choice
        options: [patch, minor, major]
        default: patch

jobs:
  ci:
    name: CI
    permissions:
      contents: write
      packages: write
    uses: psychodracon/github-workflows/.github/workflows/node-service.yaml@v1
    with:
      version_bump: ${{ inputs.version_bump || 'patch' }}
```

The calling job must grant `contents: write` and `packages: write`: new repositories get a read-only
token by default, and a called workflow cannot raise it.

Pull requests only build and test. A push or manual run on the default branch also releases: a push
bumps the patch version, a manual run picks the bump from the `version_bump` choice. The caller has to
declare that choice and pass it on as above, otherwise every run bumps the patch. The `|| 'patch'`
covers pushes, where `inputs` is empty.

## Workflows

| Workflow | For | Version comes from | Publishes |
| --- | --- | --- | --- |
| `node-service.yaml` | Node.js services | `package.json` | image `ghcr.io/<owner>/<repo>` |
| `node-library.yaml` | npm packages | `package.json` | package on GitHub Packages |
| `node-action.yaml` | JavaScript actions | `package.json` | git tags, including the moving `v<major>` |
| `dotnet-service.yaml` | .NET services | an MSBuild file (`version_file`) | image |
| `docker-image.yaml` | anything with a Dockerfile | git tags only | image |

Common inputs: `version_bump` and `disable_publish` (build only).
`dotnet-service.yaml` also takes `version_file` (default `Directory.Build.props`).

Images are tagged `X.Y.Z` and `latest`.

## Release flow

1. Build and test.
2. Work out the version: a version in a file that has no tag yet is released as it is, otherwise it is
   bumped.
3. Build the image (or package).
4. Commit the bumped files, tag `vX.Y.Z` and push both.
5. Only then push the image or publish the package, so nothing is released that has no tag.

## Actions

Workflows are built from the actions in `.github/actions`, which repositories with their own release
process (window-mover, jellyfin-plugin-where-to-watch, pokopia-dex) use directly:

| Action | Purpose |
| --- | --- |
| `publish-check` | Decides whether this run publishes and which ref to check out |
| `version` | Computes the next version (`npm`, `msbuild` with three or four parts, or `tags`) and bumps the files |
| `git-release` | Commits the bumped files, tags the release and pushes atomically |
| `setup-node` | Installs Node.js from `.nvmrc` and points the `@psychodracon` scope at GitHub Packages |
| `node-ci`, `dotnet-ci` | Restore, build, lint and test |
| `docker-build`, `docker-push` | Build the image, then push it after the release is tagged |
| `notify` | Sends a Pushover message via [github-action-pushover](https://github.com/psychodracon/github-action-pushover) |

## Development

Workflows are checked with `actionlint` (version pinned in `mise.toml`, install with `mise install`),
and the version logic has tests:

```sh
test/version.test.sh
```

Changes reach the other repositories only when this repository's CI has released and moved `v1`.

## License

Copyright (C) Kamil Ganczarek. Licensed under the GNU General Public License, version 3 or (at your option) any later version. See [LICENSE](LICENSE).
