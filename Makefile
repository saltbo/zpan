.PHONY: default install build fmt test vet docker clean

BINARY="zpan"
MKFILE_PATH := $(abspath $(lastword $(MAKEFILE_LIST)))
MKFILE_DIR := $(dir $(MKFILE_PATH))

TARGET_DIR=${MKFILE_DIR}build
TARGET_PATH=${TARGET_DIR}/${BINARY}

# git info
COMMIT := git-$(shell git rev-parse --short HEAD)
GITREPO := $(shell git config --get remote.origin.url)
RELEASE := $(shell git describe --tags | awk -F '-' '{print $$1}')

default: install build

fmt:
	@gofmt -s -w ${GOFILES}

build:
	@go build -i -v -ldflags "-s -w -X ${BINARY}/version.release=${RELEASE} -X ${BINARY}/version.commit=${COMMIT} -X ${BINARY}/version.repo=${GITREPO}" \
	-o ${TARGET_PATH} ${MKFILE_DIR}cmd/server.go

install:
	go mod download

test:
	go test -coverprofile=coverage.txt -covermode=atomic ./...
    go tool cover --func=coverage.txt

covhtml:
	go tool cover -html=coverage.txt

clean:
	rm -rf ${TARGET_DIR}