# github-workflows

Reusable workflows and composite actions for all repositories. What they do and how to call them is in
[README.md](README.md).

- Every repository refers to this one as `psychodracon/github-workflows@v1`, and GitHub does not redirect
  renamed actions, so do not rename the repository.
- A change reaches the other repositories only after this repository's CI has released and moved `v1`.
  Internal references use `@v1` too, except in this repository's own `ci.yaml`, which uses the local
  `./.github/actions` of the commit under test.
- Check workflows with `actionlint` (pinned in `mise.toml`) and run `test/version.test.sh` after touching
  `.github/actions/version`.
- Pushes made with `GITHUB_TOKEN` do not start workflows, so release commits need no `[skip ci]`.
- `renovate.json` turns off the shared automerge for GitHub Actions updates: a merge here moves `v1` for
  every repository, so those PRs are merged by hand.
