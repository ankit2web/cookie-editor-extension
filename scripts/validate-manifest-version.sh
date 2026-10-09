#!/usr/bin/env bash
set -euo pipefail

MANIFEST_PATH="${1:-manifest.json}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Error: manifest file not found: $MANIFEST_PATH" >&2
  exit 1
fi

# Validate the JSON string itself so trailing newlines cannot be stripped by
# command substitution before the shell regex runs.
if ! jq -e '
  .version as $v
  | (($v | type) == "string")
    and ($v | test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))
    and (($v | contains("\n")) | not)
    and (($v | contains("\r")) | not)
' "$MANIFEST_PATH" > /dev/null; then
  echo "Error: invalid manifest version. Expected three dot-separated integer components (for example, 2.1.0); prerelease suffixes and build metadata are not allowed." >&2
  exit 1
fi

VERSION="$(jq -r '.version' "$MANIFEST_PATH")"
VERSION_REGEX='^[0-9]+\.[0-9]+\.[0-9]+$'

if [[ ! "$VERSION" =~ $VERSION_REGEX ]]; then
  echo "Error: version '$VERSION' is invalid; prerelease suffixes are not allowed." >&2
  exit 1
fi

printf '%s\n' "$VERSION"
