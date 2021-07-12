## Install

### Linux
```bash
# 安装服务
curl -sSf https://dl.saltbo.cn/install.sh | sh -s zpan

# 启动服务
systemctl start zpan

# 查看服务状态
systemctl status zpan

# 设置开机启动
systemctl enable zpan

# 查看日志
journalctl -xe -u zpan -f
```

### Docker
```bash
docker run -it -p 8222:8222 -v /etc/zpan:/etc/zpan --name zpan saltbo/zpan
```

## Usage

visit http://localhost:8222