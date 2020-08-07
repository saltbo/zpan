ZPan - Your Last disk on the cloud. 
=========================

[![](https://github.com/saltbo/zpan/workflows/build/badge.svg)](https://github.com/saltbo/zpan/actions?query=workflow%3Abuild)
[![](https://codecov.io/gh/saltbo/zpan/branch/master/graph/badge.svg)](https://codecov.io/gh/saltbo/zpan)
[![](https://wakatime.com/badge/github/saltbo/zpan.svg)](https://wakatime.com/badge/github/saltbo/zpan)
[![](https://api.codacy.com/project/badge/Grade/88817db9b3b04c0293c9d001d574a5ef)](https://app.codacy.com/manual/saltbo/zpan?utm_source=github.com&utm_medium=referral&utm_content=saltbo/zpan&utm_campaign=Badge_Grade_Dashboard)
[![](https://img.shields.io/github/v/release/saltbo/zpan.svg)](https://github.com/saltbo/github.com/saltbo/zpan/releases)
[![](https://img.shields.io/github/license/saltbo/zpan.svg)](https://github.com/saltbo/github.com/saltbo/zpan/blob/master/LICENSE)

English | [🇨🇳中文](https://saltbo.cn/zpan)

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

## Install the pre-compiled binary

**homebrew**:

```bash
brew cask install zpan
```

**deb/rpm**:

Download the `.deb` or `.rpm` from the [releases page](https://github.com/saltbo/github.com/saltbo/zpan/releases) and
install with `dpkg -i` and `rpm -i` respectively.

**manually**:

Download the pre-compiled binaries from the [releases page](https://github.com/saltbo/github.com/saltbo/zpan/releases) and
copy to the desired location.

## Usage
```bash
make run
```

## Contributing
See [CONTRIBUTING](CONTRIBUTING.md) for details on submitting patches and the contribution workflow.

## Contact us
- [Author Blog](https://saltbo.cn).

## Author
- [saltbo](https://github.com/saltbo)

## License
- [MIT](https://github.com/saltbo/github.com/saltbo/zpan/blob/master/LICENSE)