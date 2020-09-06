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
- [x] Support AwsS3,GoogleStorage,AliOSS,TencentCOS,QiniuKodo

## QuickStart
### Linux
```bash
# 安装服务
curl -sSf https://dl.saltbo.cn/install.sh | sudo sh -s zpan

# 启动服务
systemctl start zpan

# 设置开机启动
systemctl enable zpan
```

### Docker
```bash
docker run -p 80:8081 -v /etc/zpan:/root -it saltbo/zpan:latest
```

## Contributing
See [CONTRIBUTING](CONTRIBUTING.md) for details on submitting patches and the contribution workflow.

## Contact us
- [Author Blog](https://saltbo.cn).

## Author
- [saltbo](https://github.com/saltbo)

## License
- [MIT](https://github.com/saltbo/github.com/saltbo/zpan/blob/master/LICENSE)