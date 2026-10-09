#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="$ROOT_DIR/scripts/validate-manifest-version.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS_COUNT=0
FAIL_COUNT=0

write_manifest() {
  jq -n --arg version "$1" '{version: $version}' > "$TMP_DIR/manifest.json"
}

assert_accept() {
  local version="$1"
  write_manifest "$version"
  local output
  if ! output="$(bash "$VALIDATOR" "$TMP_DIR/manifest.json" 2>"$TMP_DIR/stderr")"; then
    echo "FAIL: expected '$version' to be accepted" >&2
    cat "$TMP_DIR/stderr" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  if [[ "$output" != "$version" ]]; then
    echo "FAIL: validator output mismatch for '$version': '$output'" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  echo "PASS: accepts '$version'"
  PASS_COUNT=$((PASS_COUNT + 1))
}

assert_reject() {
  local description="$1"
  local version="$2"
  write_manifest "$version"
  local output
  if output="$(bash "$VALIDATOR" "$TMP_DIR/manifest.json" 2>"$TMP_DIR/stderr")"; then
    echo "FAIL: expected rejection for $description (got '$output')" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  if [[ -n "$output" ]]; then
    echo "FAIL: invalid version wrote output before failing for $description: '$output'" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
    return
  fi
  echo "PASS: rejects $description before writing output"
  PASS_COUNT=$((PASS_COUNT + 1))
}

assert_accept "2.1.0"
assert_accept "2.0.3"

assert_reject "prerelease suffix" "2.1.0-beta"
assert_reject "numeric prerelease suffix" "2.1.0-beta.1"
assert_reject "build metadata" "2.1.0+build.1"
assert_reject "missing version string" ""
assert_reject "nonnumeric component" "2.one.0"
assert_reject "leading whitespace" " 2.1.0"
assert_reject "trailing whitespace" "2.1.0 "
assert_reject "newline-containing version" $'2.1.0\n'

printf '{}' > "$TMP_DIR/manifest.json"
if output="$(bash "$VALIDATOR" "$TMP_DIR/manifest.json" 2>"$TMP_DIR/stderr")"; then
  echo "FAIL: expected missing version property to be rejected" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
elif [[ -n "$output" ]]; then
  echo "FAIL: missing version property wrote output before failing" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "PASS: rejects missing version property before writing output"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# Ensure the current checked-in manifest version remains valid.
output="$(bash "$VALIDATOR" "$ROOT_DIR/manifest.json")"
if [[ "$output" == "$(jq -r '.version' "$ROOT_DIR/manifest.json")" ]]; then
  echo "PASS: accepts the current manifest version ($output)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "FAIL: current manifest version was not accepted" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo
echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"
[[ "$FAIL_COUNT" -eq 0 ]]
