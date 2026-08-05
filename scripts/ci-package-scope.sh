#!/usr/bin/env bash
set -euo pipefail

base_sha=$1
scope=$2
event_name=$3

if [[ "$event_name" != pull_request ]]; then
  echo 'run=true'
  exit 0
fi

common_paths=(
  .github/workflows/ci.yml
  .dockerignore
  Dockerfile
  scripts/ci-package-scope.sh
)

case "$scope" in
  cli)
    paths=("${common_paths[@]}" cmd)
    ;;
  server)
    paths=(
      "${common_paths[@]}"
      docker-compose.yml
      package.json
      patches
      pnpm-lock.yaml
      scripts/docker-entrypoint.sh
    )
    ;;
  *)
    echo "unknown package scope: $scope" >&2
    exit 1
    ;;
esac

if git diff --quiet "$base_sha" HEAD -- "${paths[@]}"; then
  echo 'run=false'
else
  echo 'run=true'
fi
