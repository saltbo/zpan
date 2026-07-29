#!/usr/bin/env bash
set -euo pipefail

version="${1:?version is required}"
out_dir="${2:?output directory is required}"

mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"

targets=(
  "darwin amd64 tar.gz"
  "darwin arm64 tar.gz"
  "linux amd64 tar.gz"
  "linux arm64 tar.gz"
  "windows amd64 zip"
  "windows arm64 zip"
)

for target in "${targets[@]}"; do
  (
    read -r goos goarch ext <<<"$target"
    work_dir="$(mktemp -d)"
    trap 'rm -rf "$work_dir"' EXIT
    bin_name="restish-zpan"
    if [ "$goos" = "windows" ]; then
      bin_name="restish-zpan.exe"
    fi

    GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 \
      go build -trimpath -ldflags "-s -w -X main.version=${version}" \
      -o "${work_dir}/${bin_name}" ./restish-zpan

    archive="${out_dir}/restish-zpan_${goos}_${goarch}.${ext}"
    if [ "$ext" = "zip" ]; then
      (cd "$work_dir" && zip -q "$archive" "$bin_name")
    else
      tar -C "$work_dir" -czf "$archive" "$bin_name"
    fi
  )
done
