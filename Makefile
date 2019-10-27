.PHONY: default install build fmt test vet docker clean

default: build

build:
	GO_BUILD_FLAGS="-v" ./scripts/build.sh
	./bin/zpan --version

run:
	./bin/zpan

install:
	./scripts/install.sh

release:
	./scripts/release.sh

test:
	go test -coverprofile=coverage.txt -covermode=atomic ./...
    go tool cover --func=coverage.txt

covhtml:
	go tool cover -html=coverage.txt

clean:
	rm -rf bin
	rm -rf build
