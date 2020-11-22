# debug
是否输出debug日志，默认为false

# invitation
邀请注册是否开启，开启后只允许邀请注册，默认关闭

# storage
给每个用户分配的初始空间，默认50兆，单位：字节

# server
服务器配置

```yaml
server:
  port: 8222
  sslport: 443
  domain:
   - example1.com
   - example2.com
```

### port
Http端口，默认为8222

### sslport
Https端口, 当前只支持443

### domain
服务器域名列表

# tls
TLS配置
```yaml
tls:
  enabled: true
  auto: true
  cacheDir: /opt/
  certPath: "/etc/domain/cert.pem"
  certkeyPath: "/etc/domain/cert.key"
```

### enable
是否开启HTTPS

### auto
是否使用let's encrypt 自动申请证书

### cacheDir
Let's encrypt 证书缓存目录

### certPath
手动配置证书

### certkeyPath
手动配置证书

# database
这里定义了ZPan的数据库驱动
```yaml
database:
  driver: sqlite3
  dsn: zpan.db
```

### driver 
我们支持四种数据库驱动，您可以根据需求进行选择

- sqlite3
- mysql
- postgres
- mssql

### dsn
不用的驱动对应的dsn也是不一样的，这里我们分别给出每种驱动的dsn格式

|  driver   | dsn  |
|  ----  | ----  |
| sqlite3  | zpan.db |
| mysql  | user:pass@tcp(127.0.0.1:3306)/zpan?charset=utf8mb4&parseTime=True&loc=Local |
| postgres  | user=zpan password=zpan dbname=zpan port=9920 sslmode=disable TimeZone=Asia/Shanghai |
| mssql  | sqlserver://zpan:LoremIpsum86@localhost:9930?database=zpan |

# provider
目前我们支持所有基于S3的云存储平台，比如阿里云OSS、腾讯云COS、七牛云KODO。
```yaml
provider:
  name: s3
  bucket: saltbo-zpan-test
  endpoint: https://oss-cn-zhangjiakou.aliyuncs.com
  accessKey: LTAIxxxxxxxxxxxxxxx7YoV
  accessSecret: PFGVwxxxxxxxxxxxxxxxxRd09u
```

#### name
您使用的云存储名称，可选如下

- s3(默认)
- od(暂不支持)
- gd(暂不支持)

#### bucket
您创建的存储空间名称

#### endpoint
云存储的接入点

#### customHost
云存储绑定的自定义域名

#### customPublicPath
云存储绑定的自定义公共路径，供匿名访问

#### accessKey
从云存储申请的访问KEY

#### accessSecret
从云存储申请的访问秘钥

# email
配置发信邮箱即可开启账号注册的邮箱验证
```yaml
email:
  host: smtpdm.aliyun.com:25
  sender: no-reply@saltbo.fun
  username: Zpan
  password: mGxxxxxxxxxxh9
```

### host
发信服务地址，eg:: smtpdm.aliyun.com:25

### sender: 
发信地址，eg:no-reply@saltbo.fun

### username
发信人，eg：Zpan

### password
发信密码