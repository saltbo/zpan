### 贡献代码

!> 参与该项目，即表示您同意遵守我们的[行为准则](/CODEOFCONDUCT.md)。 

### 安装环境

`zpan` 基于[Go](https://golang.org/)进行开发.

依赖:

- `make`
- [Go 1.13+](https://golang.org/doc/install)

克隆源码:

```sh
$ git clone git@github.com:saltbo/zpan.git
```

安装构建依赖:

```sh
$ make dep
```

运行单元测试

```sh
$ make test
```

### 测试你的修改

您可以为更改创建分支，并尝试从源代码进行构建:

```sh
$ make build
```

### 创建一个提交

提交消息的格式应正确，并使其“标准化”，我们正在使用常规提交。

您可以按照以下文档操作
[their website](https://www.conventionalcommits.org).

### 提交一个Pull Request
将分支推到您的`zpan`分支，然后对主分支打开一个拉取请求。