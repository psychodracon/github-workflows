#!/usr/bin/env bash
set -euo pipefail

TYPE="${VERSION_TYPE:?VERSION_TYPE is required}"
PATHS="${VERSION_PATHS:-.}"
BUMP="${VERSION_BUMP:-patch}"
PREFIX="${VERSION_TAG_PREFIX:-v}"
VERSION_RE='^[0-9]+(\.[0-9]+){2,3}$'

fail() {
  echo "::error::$*" >&2
  exit 1
}

tag_exists() {
  git ls-remote --exit-code --tags --refs origin "refs/tags/${PREFIX}$1" > /dev/null 2>&1
}

bump() {
  local -a parts
  local index
  IFS=. read -ra parts <<< "$1"
  case "$BUMP" in
    major) index=0 ;;
    minor) index=1 ;;
    patch) index=2 ;;
    revision)
      [[ ${#parts[@]} -eq 4 ]] || fail "Bump 'revision' needs a four-part version, got $1"
      index=3
      ;;
    *) fail "Unknown bump '${BUMP}'" ;;
  esac
  parts[index]=$((parts[index] + 1))
  for ((i = index + 1; i < ${#parts[@]}; i++)); do parts[i]=0; done
  local IFS=.
  echo "${parts[*]}"
}

read_version() {
  case "$TYPE" in
    npm) jq -r '.version // empty' "${1%/}/package.json" ;;
    msbuild) grep -oPm1 '(?<=<Version>)[0-9]+(\.[0-9]+){2,3}(?=</Version>)' "$1" || true ;;
  esac
}

write_version() {
  case "$TYPE" in
    npm) (cd "$1" && npm version "$3" --no-git-tag-version > /dev/null) ;;
    msbuild) sed -i "0,/<Version>$2<\/Version>/s//<Version>$3<\/Version>/" "$1" ;;
  esac
}

changed_files() {
  local path dir
  for path in $PATHS; do
    case "$TYPE" in
      npm)
        dir="${path%/}/"
        if [[ "$dir" == ./ ]]; then dir=""; fi
        echo -n "${dir}package.json "
        if [[ -f "${dir}package-lock.json" ]]; then echo -n "${dir}package-lock.json "; fi
        ;;
      msbuild) echo -n "${path} " ;;
    esac
  done
}

latest_tag_version() {
  git ls-remote --tags --refs origin "refs/tags/${PREFIX}*" \
    | sed -E 's#.*refs/tags/##' \
    | grep -E "^${PREFIX}[0-9]+(\.[0-9]+){2,3}$" \
    | sed "s/^${PREFIX}//" \
    | sort -V \
    | tail -n 1 || true
}

files=""
case "$TYPE" in
  tags)
    current="$(latest_tag_version)"
    if [[ -z "$current" ]]; then
      next="1.0.0"
    else
      next="$(bump "$current")"
    fi
    ;;
  npm | msbuild)
    current=""
    for path in $PATHS; do
      found="$(read_version "$path")"
      [[ "$found" =~ $VERSION_RE ]] || fail "No version found in ${path}"
      if [[ -n "$current" && "$found" != "$current" ]]; then
        fail "Versions differ: ${path} has ${found}, expected ${current}"
      fi
      current="$found"
    done
    if tag_exists "$current"; then
      next="$(bump "$current")"
      for path in $PATHS; do write_version "$path" "$current" "$next"; done
      files="$(changed_files)"
    else
      next="$current"
    fi
    ;;
  *) fail "Unknown type '${TYPE}'" ;;
esac

{
  echo "version=${next}"
  echo "files=${files% }"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
