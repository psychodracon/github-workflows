# github-workflows

Reusable workflows and composite actions; usage and the release flow are in [README.md](README.md).

- Every caller names this repository in its `uses:` lines and GitHub does not redirect renamed
  actions, so the name is fixed.
- The internal `psychodracon/github-workflows/...@v<major>` references belong to the release, which
  rewrites them. A change that breaks callers gets a `type!:` subject or a `BREAKING CHANGE:` footer,
  which makes its release the next major.
- The `version` action is plain Node.js (`runs: node24`, no dependencies, no build step) so it runs on
  every runner OS. The other actions are composite with bash steps.
- After changing an action, run `actionlint` and `node --test "test/actions/*.test.mjs"`, and mirror new
  inputs or changed calls in the matching e2e job in `ci.yaml` (fixtures in `test/e2e/`).
