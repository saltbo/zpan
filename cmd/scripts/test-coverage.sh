#!/usr/bin/env bash
set -euo pipefail

threshold="${CMD_COVERAGE_MIN:-70}"
profile="$(mktemp "${TMPDIR:-/tmp}/zpan-cmd-coverage.XXXXXX")"
filtered="$(mktemp "${TMPDIR:-/tmp}/zpan-cmd-coverage-filtered.XXXXXX")"
trap 'rm -f "$profile" "$filtered"' EXIT

go test ./... -coverprofile="$profile"
grep -v 'internal/openapi/client\.gen\.go' "$profile" >"$filtered"

coverage="$(go tool cover -func="$filtered" | awk '/^total:/ { sub(/%$/, "", $3); print $3 }')"
if [ -z "$coverage" ]; then
	echo "failed to read cmd coverage total" >&2
	exit 1
fi

awk -v coverage="$coverage" -v threshold="$threshold" 'BEGIN {
	if (coverage + 0 < threshold + 0) {
		printf("cmd coverage %.1f%% is below %.1f%%\n", coverage, threshold) > "/dev/stderr"
		exit 1
	}
	printf("cmd coverage %.1f%% meets %.1f%% threshold\n", coverage, threshold)
}'
