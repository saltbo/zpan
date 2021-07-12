# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- Support view the pdf files
- support edit text file
- support responsive for different devices
- support visual configuration guidance
- support WebDAV
- compression/decompression
- support upload in the background
- Aria2 download into zpan
- support onedrive && google drive

## [1.6.0] - 2021-07-12
### Added
- 增加对又拍云的支持 #55
- 支持禁用某个云存储 #103
- 支持禁用/删除某个用户 #113
- 支持永久分享和取消分享
- 前端页面右上角增加显示用户昵称显示
- 管理员后台重置密码不再需要原密码
- 增加开发者设置，开放API文档，支持开发者自行上传文件
- 云平台的数据来源接入eplist，希望社区一起维护该项目 #84
- 增加对ARM64的支持，可以允许在ARM架构的机器上了 #52

### Fixed
- 修复用户无法重置密码的问题 #105
- 修复上传中断/失败仍然占用了存储空间的问题 #78  
- 修复分享列表存在的越权问题
- 修复上传多个文件时其中一个文件完成导致其他文件结束的问题  
- 修复部分RAR和DMG文件分享后无法下载的问题
- 调整上传签名有效期，解决上传较慢时过期导致失败的问题
- 调整自用域名仅用于查看或下载文件，不再用于上传 #111

## [1.5.0] - 2020-02-14
### Added
- 增加了可视化的引导安装页面，帮助用户快速安装
- 支持多存储，在后台管理员可以添加多个存储空间，在前台用户可以随意切换存储空间
- 添加存储空间时支持自动设置 CORS （部分平台不支持），解决手动去云存储平台创建的麻烦
- 存储空间支持网盘和外链盘两种类型，网盘关联的云存储设置为私有读，外链盘关联的云存储设置为公共读
- 支持管理员在后台添加用户
- 支持设置存储根路径和存储文件路径（支持使用变量）
- 增加基本的后台管理功能
- 增加 heroku 的支持，可以一键部署到 heroku

## [1.4.0] - 2020-10-13
### Added
- redesign UI
- support Recycle Bin
- support update the user storage quota
- support icon-layout for the file list
- support auto https
- support minio


## [1.3.0] - 2020-09-20
### Added
- support search
- support delete the folder [@XiangYu0777](https://github.com/XiangYu0777)
- support preview for the audio and video
- support aws-s3 && google storage
- support i18n


### Changed
- Fix: don't allow move the folder into itself [@holicc](https://github.com/holicc)
- Fix: error display the file that upload failed for the sqlite3 driver
- Fix: error display the folders of move dialog when the folder renamed
- Improve the test coverage to 54%
