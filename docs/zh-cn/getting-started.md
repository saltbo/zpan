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

### Usage
>管理员默认账号密码会输出到Stdout，请到启动日志里获取并记录

visit http://yourip:8222

## 配置文件
!>您需要将provider中的信息改为您自己云存储的配置

```yaml
debug: false
invitation: false
storage: 104857600

database:
  driver: sqlite3
  dsn: zpan.db

provider:
  name: oss
  bucket: saltbo-zpan-test
  endpoint: https://oss-cn-zhangjiakou.aliyuncs.com
  customHost: http://dl-test.saltbo.cn
  accessKey: LTAIxxxxxxxxxxxxxxx7YoV
  accessSecret: PFGVwxxxxxxxxxxxxxxxxRd09u

#email:
#  host: smtpdm.aliyun.com:25
#  sender: no-reply@saltbo.fun
#  username: Zpan
#  password: mGxxxxxxxxh9
```

?>默认路径：/etc/zpan/zpan.yml