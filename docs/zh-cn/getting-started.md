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
docker run -p 80:8222 -v /etc/zpan:/zpan -it saltbo/zpan:latest
```