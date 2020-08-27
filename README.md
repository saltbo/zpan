ZPan - Your Last disk on the cloud. 
=========================
[![Build Status](https://travis-ci.org/saltbo/zpan.svg)](https://travis-ci.org/saltbo/zpan)
[![codecov](https://codecov.io/gh/saltbo/zpan/branch/master/graph/badge.svg)](https://codecov.io/gh/saltbo/zpan)
[![codebeat badge](https://codebeat.co/badges/e97d3305-de49-4a9c-9ead-1aca942b9e16)](https://codebeat.co/projects/github-com-saltbo-zpan-master)
[![Go Report Card](https://goreportcard.com/badge/github.com/saltbo/zpan)](https://goreportcard.com/report/github.com/saltbo/zpan)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fsaltbo%2Fzpan.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fsaltbo%2Fzpan?ref=badge_shield)

## Features
- [x] File Manage
- [x] Folder Manage
- [x] File & Folder Share
- [x] Picture library
- [x] Storage Capacity Control
- [ ] RecycleBin
- [x] Support AliOSS
- [ ] Support Upyun
- [ ] Support Qiniuyun

## Run environment
- Mac
- Linux

## Dependent modules 
- cli (github.com/urfave/cli) 
- gin (github.com/gin-gonic/gin)
- jwt-go (github.com/dgrijalva/jwt-go)
- xorm (github.com/go-xorm/xorm)
- grbac (github.com/storyicon/grbac)
- statik (github.com/rakyll/statik)
- oss (github.com/aliyun/aliyun-oss-go-sdk/oss)

## Install

### Binary
Download the appropriate binary for your platform from the [Releases](https://github.com/saltbo/zpan/releases) page

```bash
cp config.yaml.tpl config.yaml
vi config.yaml  #setup your configs
./zpan
```

### Source

> depend on [Golang](https://golang.org/dl/) compiler environment

```bash
git clone https://github.com/saltbo/zpan.git
cd zpan && make && make install
```

## Usage
```bash
make run
```


## Contact us
- [Author Blog](https://saltbo.cn).

## Author
- [Saltbo](https://github.com/saltbo)

## License
- [MIT](https://github.com/saltbo/zpan/blob/master/LICENSE)


[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fsaltbo%2Fzpan.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2Fsaltbo%2Fzpan?ref=badge_large)