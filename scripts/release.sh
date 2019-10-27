#!/usr/bin/env bash

PROJ="zpan"
RELEASE=$(git describe --tags | awk -F '-' '{print $1}')

function package() {
	local target=${1}
	local srcdir="bin"

	cp "${srcdir}/${PROJ}" "${target}/${PROJ}"
	cp ../developments/* "${target}"
	cp ../README.md "${target}"/README.md
	cp ../CHANGELOG.md "${target}"/CHANGELOG.md
	rm -r ${srcdir}

	return
}

function main() {
	ROOT_DIR=$(dirname $(cd "$(dirname "$0")";pwd))
	TARGET_DIR=${ROOT_DIR}"/build"
	echo ${TARGET_DIR}
	mkdir -p ${TARGET_DIR}
	cd ${TARGET_DIR}

	TARGET_ARCH="amd64"
	for os in darwin windows linux; do
		export GOOS=${os}
		export GOARCH=${TARGET_ARCH}
		LDFLAGS="-s" ${ROOT_DIR}/scripts/build.sh

		TARGET="${PROJ}-${RELEASE}-${GOOS}-${GOARCH}"
		mkdir "${TARGET}"
		package "${TARGET}"

		if [ ${GOOS} == "linux" ]; then
			tar cfz "${TARGET}.tar.gz" "${TARGET}"
		else
			zip -qr "${TARGET}.zip" "${TARGET}"
		fi
		echo "Wrote ${TARGET}.tar.gz"

	done
}

main