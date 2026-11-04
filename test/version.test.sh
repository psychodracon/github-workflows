#!/usr/bin/env bash
# Tests for .github/actions/version/version.sh against throwaway git repositories.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/.github/actions/version/version.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=0

new_repo() {
  local name="$1"
  git init -q --bare "$WORK/${name}.git"
  git clone -q "$WORK/${name}.git" "$WORK/$name" 2> /dev/null
  cd "$WORK/$name"
  git config user.name test
  git config user.email test@example.com
}

tag() {
  git commit -q --allow-empty -m "release $1"
  git tag "$1"
  git push -q origin "refs/tags/$1"
}

run() {
  local out="$WORK/output"
  : > "$out"
  GITHUB_OUTPUT="$out" "$SCRIPT" > /dev/null
  version="$(sed -n 's/^version=//p' "$out")"
  files="$(sed -n 's/^files=//p' "$out")"
}

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "ok   $name"
  else
    echo "FAIL $name: expected '$expected', got '$actual'"
    failures=$((failures + 1))
  fi
}

check_fails() {
  local name="$1"
  if (GITHUB_OUTPUT=/dev/null "$SCRIPT" > /dev/null 2>&1); then
    echo "FAIL $name: expected a failure"
    failures=$((failures + 1))
  else
    echo "ok   $name"
  fi
}

props() { echo "<Project><PropertyGroup><Version>$1</Version></PropertyGroup></Project>" > "$2"; }

export VERSION_TYPE=msbuild VERSION_PATHS=Directory.Build.props VERSION_BUMP=patch

new_repo msbuild-first
props 1.0.0 Directory.Build.props
run
check "msbuild: untagged version is released unchanged" "1.0.0" "$version"
check "msbuild: unchanged version touches no files" "" "$files"

new_repo msbuild-bump
props 1.0.0 Directory.Build.props
tag v1.0.0
run
check "msbuild: tagged version is bumped" "1.0.1" "$version"
check "msbuild: bumped file is reported" "Directory.Build.props" "$files"
check "msbuild: file is rewritten" "1.0.1" "$(grep -oP '(?<=<Version>)[^<]+' Directory.Build.props)"

new_repo msbuild-minor
props 1.4.7 Directory.Build.props
tag v1.4.7
VERSION_BUMP=minor run
check "msbuild: minor resets patch" "1.5.0" "$version"

new_repo msbuild-major
props 1.4.7 Directory.Build.props
tag v1.4.7
VERSION_BUMP=major run
check "msbuild: major resets minor and patch" "2.0.0" "$version"

new_repo msbuild-four
props 1.0.0.0 Directory.Build.props
tag v1.0.0.0
VERSION_BUMP=revision run
check "msbuild: revision bumps the fourth part" "1.0.0.1" "$version"
props 1.0.0.0 Directory.Build.props
VERSION_BUMP=patch run
check "msbuild: patch resets the revision" "1.0.1.0" "$version"

new_repo msbuild-revision-three
props 1.0.0 Directory.Build.props
tag v1.0.0
VERSION_BUMP=revision check_fails "msbuild: revision needs four parts"

new_repo msbuild-missing
echo "<Project/>" > Directory.Build.props
check_fails "msbuild: missing version fails"

export VERSION_TYPE=tags VERSION_PATHS=. VERSION_BUMP=patch

new_repo tags-none
run
check "tags: no tag releases 1.0.0" "1.0.0" "$version"
check "tags: no files" "" "$files"

new_repo tags-latest
tag v1.0.0
tag v1.0.3
tag v1.0.10
tag v1
run
check "tags: bumps the highest version and ignores the major tag" "1.0.11" "$version"

if command -v npm > /dev/null; then
  export VERSION_TYPE=npm VERSION_PATHS="backend frontend" VERSION_BUMP=patch
  pkg() { mkdir -p "$2" && echo "{\"name\":\"$2\",\"version\":\"$1\"}" > "$2/package.json"; }

  new_repo npm-first
  pkg 1.0.0 backend
  pkg 1.0.0 frontend
  run
  check "npm: untagged version is released unchanged" "1.0.0" "$version"

  new_repo npm-bump
  pkg 1.0.0 backend
  pkg 1.0.0 frontend
  tag v1.0.0
  run
  check "npm: every directory is bumped" "1.0.1" "$version"
  check "npm: both package files are reported" "backend/package.json frontend/package.json" "$files"
  check "npm: second directory is rewritten" "1.0.1" "$(jq -r .version frontend/package.json)"

  new_repo npm-mismatch
  pkg 1.0.0 backend
  pkg 1.0.1 frontend
  check_fails "npm: differing versions fail"

  export VERSION_PATHS=.
  new_repo npm-root
  echo '{"name":"root","version":"2.3.4"}' > package.json
  tag v2.3.4
  run
  check "npm: root package is bumped" "2.3.5" "$version"
  check "npm: root files have no prefix" "package.json" "$files"
fi

if ((failures > 0)); then
  echo "${failures} test(s) failed"
  exit 1
fi
echo "All tests passed"
