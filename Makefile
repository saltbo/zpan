.PHONY: all dep lint vet test test-coverage build clean

# custom define
PROJECT := zpan
MAINFILE := main.go

all: build

mod: ## Get the dependencies
	@go mod download

lint: ## Lint Golang files
	@golangci-lint --version
	@golangci-lint run -D errcheck

test: ## Run tests with coverage
	go test -coverprofile .coverprofile ./...
	go tool cover --func=.coverprofile

coverage-html: ## show coverage by the html
	go tool cover -html=.coverprofile

generate: ## generate the static assets
	go generate ./...

build: mod ## Build the binary file
	@go build -v -o build/bin/$(PROJECT) $(MAINFILE)

install:
	# 复制二进制文件
	# 复制默认配置文件

clean: ## Remove previous build
	@rm -rf ./build

help: ## Display this help screen
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'