#!/usr/bin/env bash
# Checks an e2e job's result: version 1.0.0, no changed files, and an image tagged 1.0.0 and latest
# that prints "fixture ok".
# Usage: VERSION=... FILES=... TAGS=... [IMAGE=false] test/e2e/check.sh
set -euo pipefail

fail() {
  echo "::error::$*"
  exit 1
}

[[ "$VERSION" == 1.0.0 ]] || fail "version: expected 1.0.0, got '${VERSION}'"
[[ -z "$FILES" ]] || fail "files: expected none, got '${FILES}'"
echo "ok   version ${VERSION}, no files"

if [[ "${IMAGE:-true}" == false ]]; then
  echo "ok   image skipped"
  exit 0
fi

image="ghcr.io/${GITHUB_REPOSITORY,,}"
expected="$(printf '%s\n' "${image}:1.0.0" "${image}:latest")"
actual="$(grep -v '^$' <<< "$TAGS" | sort || true)"
[[ "$actual" == "$expected" ]] || fail "tags: expected '${expected//$'\n'/ }', got '${actual//$'\n'/ }'"

while IFS= read -r tag; do
  output="$(docker run --rm "$tag")"
  [[ "$output" == "fixture ok" ]] || fail "${tag} printed '${output}', expected 'fixture ok'"
  echo "ok   ${tag} prints 'fixture ok'"
done <<< "$actual"
