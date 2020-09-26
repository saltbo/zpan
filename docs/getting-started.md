## Linux
```bash
# install service
curl -sSf https://dl.saltbo.cn/install.sh | sh -s zpan

# start service
systemctl start zpan

# check service status
systemctl status zpan

# set boot up
systemctl enable zpan
```

## Docker
```bash
docker run -p 80:8222 -v /etc/zpan:/zpan -it saltbo/zpan:latest
```

### Usage
visit http://yourip:8222


## ConfigFile
!>You need to change the information in the provider to your own cloud storage configuration

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

?>Default Path：/etc/zpan/zpan.yml