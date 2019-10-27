#!/usr/bin/env bash

set -e
PROJ="zpan"

# git info
COMMIT=git-$(git rev-parse --short HEAD || echo "GitNotFound")
GIT_REPO=$(git config --get remote.origin.url)
RELEASE=$(git describe --tags | awk -F '-' '{print $1}')

# Set GO_LDFLAGS="-s" for building without symbols for debugging.
LDFLAGS="$LDFLAGS -X ${PROJ}/version.release=${RELEASE} -X ${PROJ}/version.commit=${COMMIT} -X ${PROJ}/version.repo=${GIT_REPO}"

function main() {
    out="bin"
	go build $BUILD_FLAGS \
	-ldflags "$LDFLAGS" \
	-o "${out}/${PROJ}" ${PROJ}/cmd || return
}

main