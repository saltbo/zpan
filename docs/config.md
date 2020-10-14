# debug
Whether to output the debug log, the default is false

# invitation
Whether invitation registration is enabled, after enabling, only invitation registration is allowed, and it is disabled by default

# storage
The initial space allocated to each user, default 50 megabytes, unit: byte

# server
Configure the server
```yaml
server:
  port: 8222
  sslport: 443
  domain:
   - example1.com
   - example2.com
```

### port
Http port

### sslport
Https port, only support 443 at the moment

### domain
Domain list of the server

# tls
Configure the tls 
```yaml
tls:
  enabled: true
  auto: true
  cacheDir: /opt/
  certPath: "/etc/domain/cert.pem"
  certkeyPath: "/etc/domain/cert.key"
```

### enable
Whether to enable https

### auto
Whether to auto https using let's encrypt

### cacheDir
Let's encrypt cert cache dir, need write permission

### certPath
Manually set cert

### certkeyPath
Manually set certkey

# database
The database driver of ZPan is defined here
```yaml
database:
  driver: sqlite3
  dsn: zpan.db
```

### driver 
We support four database drivers, you can choose according to your needs

- sqlite3
- mysql
- postgres
- mssql

### dsn
The dsn corresponding to different drivers is also different, here we give the dsn format of each driver separately

|  driver   | dsn  |
|  ----  | ----  |
| sqlite3  | zpan.db |
| mysql  | user:pass@tcp(127.0.0.1:3306)/zpan?charset=utf8mb4&parseTime=True&loc=Local |
| postgres  | user=zpan password=zpan dbname=zpan port=9920 sslmode=disable TimeZone=Asia/Shanghai |
| mssql  | sqlserver://zpan:LoremIpsum86@localhost:9930?database=zpan |

# provider
Currently we support all S3-based cloud storage platforms, such as Alibaba Cloud OSS, Tencent Cloud COS, Qiniu Cloud KODO.
```yaml
provider:
  name: s3
  bucket: saltbo-zpan-test
  endpoint: https://oss-cn-zhangjiakou.aliyuncs.com
  accessKey: LTAIxxxxxxxxxxxxxxx7YoV
  accessSecret: PFGVwxxxxxxxxxxxxxxxxRd09u
```

### name
The name of the cloud storage you use, the options are as follows
- s3(default)
- od(Not currently supported)
- gd(Not currently supported)

### bucket
The name of the storage space you created

### endpoint
Access point for cloud storage

### customHost
Custom domain name bound to cloud storage

### accessKey
Access key requested from cloud storage

### accessSecret
Access secret requested from cloud storage

# email
Configure the email address to open the account registration email verification
```yaml
email:
  host: smtpdm.aliyun.com:25
  sender: no-reply@saltbo.fun
  username: Zpan
  password: mGxxxxxxxxxxh9
```

### host
Mailing service address，eg:: smtpdm.aliyun.com:25

### sender: 
Mailing address，eg:no-reply@saltbo.fun

### username
Sender，eg：Zpan

### password
Sending password