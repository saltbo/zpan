## Linux
```bash
# 安装服务
curl -sSf https://dl.saltbo.cn/install.sh | sh -s zpan

# 启动服务
systemctl start zpan

# 查看服务状态
systemctl status zpan

# 设置开机启动
systemctl enable zpan
```

## Docker
```bash
docker run -it -p 8222:8222 -v /etc/zpan:/etc/zpan --name zpan saltbo/zpan
```

## CORS

!> 由于我们采用浏览器端直传，所以存在跨域问题，请进行如下跨域配置

- Origin: http://your-domain
- AllowMethods: PUT
- AllowHeaders: content-type,content-disposition,x-amz-acl

### Usage
>管理员默认账号密码会输出到Stdout，请到启动日志里获取并记录

visit http://localhost:8222