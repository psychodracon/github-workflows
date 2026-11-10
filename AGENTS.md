# github-workflows

Reusable workflows and composite actions that build, version and release every repository in the workspace.
Usage, the workflow and action catalogue, and the release flow are in [README.md](README.md).

## Commands

```sh
mise install
actionlint
node --test "test/actions/*.test.mjs"
```

End-to-end tests run only in CI: the `ci.yaml` jobs drive the actions against `test/e2e/fixtures/`.

## Conventions

- Step names are `Area / Action` (`Setup / Checkout repository`, `Image / Push`).
- Every job sets `timeout-minutes` and explicit `permissions`.
- The `version` action stays plain Node.js (`runs: node24`, no dependencies, no build step) so it runs
  on every runner OS; the other actions are composite with bash steps.
- Internal references are `psychodracon/github-workflows/...@v<major>`. The release rewrites them, so
  leave them on the current major.
- A new or changed action input is mirrored in the matching e2e job in `ci.yaml`.

## Git and releases

- The commit subject decides the release: a `type!:` subject or a `BREAKING CHANGE:` footer releases
  the next major, anything else a patch that moves the current major tag.

## Boundaries

- **Ask first:** any change that breaks callers (removed or renamed inputs, changed outputs, new
  required permissions).
- **Never:** rename the repository (GitHub does not redirect renamed actions); move tags by hand.
