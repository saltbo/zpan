.PHONY: default install build fmt test vet docker clean

BINARY=zpan
MKFILE_PATH := $(abspath $(lastword $(MAKEFILE_LIST)))
MKFILE_DIR := $(dir $(MKFILE_PATH))

TARGET_DIR=${MKFILE_DIR}build
TARGET_PATH=${TARGET_DIR}/${BINARY}

LDFLAGS="-s -w -X ${BINARY}/version.release=${RELEASE} -X ${BINARY}/version.commit=${COMMIT} -X ${BINARY}/version.repo=${GITREPO}"

# git info
COMMIT := git-$(shell git rev-parse --short HEAD)
GITREPO := $(shell git config --get remote.origin.url)
RELEASE := $(shell git describe --tags | awk -F '-' '{print $$1}')

default: install build

install:
	go mod download

build:
	GOOS=linux GOARCH=386 go build -ldflags ${LDFLAGS} -o ${TARGET_PATH}-linux-386/${BINARY} cmd/server.go
	GOOS=linux GOARCH=amd64 go build -ldflags ${LDFLAGS} -o ${TARGET_PATH}-linux-amd64/${BINARY} cmd/server.go
	GOOS=darwin GOARCH=386 go build -ldflags ${LDFLAGS} -o ${TARGET_PATH}-darwin-386/${BINARY} cmd/server.go
	GOOS=darwin GOARCH=amd64 go build -ldflags ${LDFLAGS} -o ${TARGET_PATH}-darwin-amd64/${BINARY} cmd/server.go

test:
	go test -coverprofile=coverage.txt -covermode=atomic ./...
    go tool cover --func=coverage.txt

covhtml:
	go tool cover -html=coverage.txt

pack:
	tar -C ${TARGET_DIR} -zvcf ${TARGET_PATH}-linux-386.tar.gz ${BINARY}-linux-386/${BINARY}
	tar -C ${TARGET_DIR} -zvcf ${TARGET_PATH}-linux-amd64.tar.gz ${BINARY}-linux-amd64/${BINARY}
	tar -C ${TARGET_DIR} -zvcf ${TARGET_PATH}-darwin-386.tar.gz ${BINARY}-darwin-386/${BINARY}
	tar -C ${TARGET_DIR} -zvcf ${TARGET_PATH}-darwin-amd64.tar.gz ${BINARY}-darwin-amd64/${BINARY}

clean:
	rm -rf ${TARGET_DIR}